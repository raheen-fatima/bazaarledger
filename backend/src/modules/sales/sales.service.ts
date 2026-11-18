import type Database from 'better-sqlite3';
import { calculateSaleTotals } from '../../../../shared/money.ts';
import type {
  DiscountType,
  PaymentDTO,
  PaymentMethod,
  ProductDTO,
  RefundDTO,
  RefundItemDTO,
  SaleDTO,
  SaleItemDTO,
} from '../../../../shared/types.ts';
import { AppError, InsufficientStockError, NotFoundError } from '../../utils/errors.ts';
import { recordAuditLog } from '../../utils/audit.ts';
import { SettingsService } from '../settings/settings.service.ts';

export class SalesService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private generateReceiptNumber(prefix: 'INV' | 'RFD'): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateStamp = `${y}${m}${d}`;

    if (prefix === 'INV') {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM sales WHERE receipt_number LIKE ?`
        )
        .get(`INV-${dateStamp}-%`) as { cnt: number };
      const seq = String(row.cnt + 1).padStart(4, '0');
      return `INV-${dateStamp}-${seq}`;
    }

    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM refunds WHERE refund_number LIKE ?`)
      .get(`RFD-${dateStamp}-%`) as { cnt: number };
    const seq = String(row.cnt + 1).padStart(4, '0');
    return `RFD-${dateStamp}-${seq}`;
  }

  public getById(id: number): SaleDTO {
    const sale = this.db
      .prepare(
        `SELECT s.*, c.name as customer_name, c.phone as customer_phone
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.id = ?`
      )
      .get(id) as SaleDTO | undefined;

    if (!sale) {
      throw new NotFoundError('Sale transaction not found');
    }

    const items = this.db
      .prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC')
      .all(id) as SaleItemDTO[];

    const payments = this.db
      .prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY id ASC')
      .all(id) as PaymentDTO[];

    const refunds = this.db
      .prepare('SELECT * FROM refunds WHERE sale_id = ? ORDER BY id DESC')
      .all(id) as RefundDTO[];

    for (const refund of refunds) {
      refund.items = this.db
        .prepare(
          `SELECT ri.*, si.product_name
           FROM refund_items ri
           JOIN sale_items si ON si.id = ri.sale_item_id
           WHERE ri.refund_id = ?`
        )
        .all(refund.id) as RefundItemDTO[];
    }

    return {
      ...sale,
      items,
      payments,
      refunds,
    };
  }

  public list(query: {
    search?: string;
    payment_method?: string;
    status?: string;
    customer_id?: number;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  }): {
    items: SaleDTO[];
    total: number;
    page: number;
    page_size: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push('(s.receipt_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
      params.push(term, term, term);
    }

    if (query.payment_method && query.payment_method !== 'all') {
      conditions.push('s.payment_method = ?');
      params.push(query.payment_method);
    }

    if (query.status && query.status !== 'all') {
      conditions.push('s.status = ?');
      params.push(query.status);
    }

    if (query.customer_id) {
      conditions.push('s.customer_id = ?');
      params.push(query.customer_id);
    }

    if (query.date_from) {
      conditions.push(`date(s.created_at) >= date(?)`);
      params.push(query.date_from);
    }

    if (query.date_to) {
      conditions.push(`date(s.created_at) <= date(?)`);
      params.push(query.date_to);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.page_size ?? 25));
    const offset = (page - 1) * pageSize;

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ${whereSql}`
      )
      .get(...params) as { cnt: number };

    const items = this.db
      .prepare(
        `SELECT s.*, c.name as customer_name, c.phone as customer_phone
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ${whereSql}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as SaleDTO[];

    return { items, total: totalRow.cnt, page, page_size: pageSize };
  }

  public createSale(input: {
    idempotency_key?: string;
    customer_id?: number | null;
    cashier_name?: string;
    items: Array<{ product_id: number; quantity: number }>;
    discount_type?: DiscountType;
    discount_value?: number;
    payment_method?: PaymentMethod;
    paid_minor: number;
    payment_reference?: string;
    notes?: string;
  }): SaleDTO {
    // 1. Idempotency guard against accidental double-submission
    if (input.idempotency_key) {
      const existing = this.db
        .prepare('SELECT id FROM sales WHERE idempotency_key = ?')
        .get(input.idempotency_key) as { id: number } | undefined;
      if (existing) {
        return this.getById(existing.id);
      }
    }

    // Aggregate duplicate product rows if caller sent same product_id twice
    const mergedMap = new Map<number, number>();
    for (const row of input.items) {
      mergedMap.set(row.product_id, (mergedMap.get(row.product_id) ?? 0) + row.quantity);
    }

    const settings = new SettingsService(this.db).getSettings();

    const saleId = this.db.transaction(() => {
      if (input.customer_id) {
        const cust = this.db
          .prepare('SELECT id FROM customers WHERE id = ? AND is_active = 1')
          .get(input.customer_id);
        if (!cust) {
          throw new AppError('Selected customer does not exist', 400, 'INVALID_CUSTOMER');
        }
      }

      const resolvedItems: Array<{
        product: ProductDTO;
        quantity: number;
        lineSubtotalMinor: number;
      }> = [];

      for (const [productId, quantity] of mergedMap.entries()) {
        const product = this.db
          .prepare('SELECT * FROM products WHERE id = ?')
          .get(productId) as ProductDTO | undefined;

        if (!product) {
          throw new NotFoundError(`Product #${productId} not found`);
        }
        if (product.is_active !== 1) {
          throw new AppError(
            `Product "${product.name}" is archived and cannot be sold`,
            400,
            'INACTIVE_PRODUCT'
          );
        }
        if (!settings.allow_negative_inventory && product.stock_qty < quantity) {
          throw new InsufficientStockError(
            `Insufficient stock for "${product.name}". Available: ${product.stock_qty} ${product.unit}, requested: ${quantity}.`,
            {
              product_id: product.id,
              product_name: product.name,
              available: product.stock_qty,
              requested: quantity,
            }
          );
        }

        resolvedItems.push({
          product,
          quantity,
          lineSubtotalMinor: product.selling_price_minor * quantity,
        });
      }

      const discountType: DiscountType = input.discount_type ?? 'none';
      const discountValue = input.discount_value ?? 0;

      // Authoritative backend calculation (never trust frontend totals)
      const totals = calculateSaleTotals({
        items: resolvedItems.map((i) => ({
          unitPriceMinor: i.product.selling_price_minor,
          quantity: i.quantity,
        })),
        discountType,
        discountValue,
        taxRateBps: settings.tax_rate_bps,
        taxInclusive: settings.tax_inclusive,
      });

      if (input.paid_minor < totals.totalMinor) {
        throw new AppError(
          `Paid amount (${input.paid_minor}) is less than grand total (${totals.totalMinor})`,
          400,
          'INSUFFICIENT_PAYMENT',
          { total_minor: totals.totalMinor, paid_minor: input.paid_minor }
        );
      }

      const changeMinor = input.paid_minor - totals.totalMinor;
      const paymentMethod: PaymentMethod = input.payment_method ?? settings.default_payment_method;
      const cashierName = input.cashier_name ?? settings.default_cashier_name;
      const receiptNumber = this.generateReceiptNumber('INV');

      const saleInfo = this.db
        .prepare(
          `INSERT INTO sales (
            receipt_number, idempotency_key, customer_id, cashier_name,
            subtotal_minor, discount_type, discount_value, discount_amount_minor,
            tax_rate_bps, tax_amount_minor, total_minor, paid_minor, change_minor,
            payment_method, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
        )
        .run(
          receiptNumber,
          input.idempotency_key ?? null,
          input.customer_id ?? null,
          cashierName,
          totals.subtotalMinor,
          discountType,
          discountValue,
          totals.discountAmountMinor,
          settings.tax_rate_bps,
          totals.taxAmountMinor,
          totals.totalMinor,
          input.paid_minor,
          changeMinor,
          paymentMethod,
          input.notes ?? ''
        );

      const newSaleId = Number(saleInfo.lastInsertRowid);

      const insertSaleItem = this.db.prepare(
        `INSERT INTO sale_items (
          sale_id, product_id, product_name, barcode, sku, unit,
          quantity, unit_price_minor, purchase_price_minor, line_subtotal_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const updateStock = this.db.prepare(
        `UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
      );

      const insertMovement = this.db.prepare(
        `INSERT INTO inventory_movements (
          product_id, movement_type, quantity_delta, stock_before, stock_after,
          reference_type, reference_id, reason, performed_by
        ) VALUES (?, 'sale', ?, ?, ?, 'sale', ?, ?, ?)`
      );

      for (const item of resolvedItems) {
        insertSaleItem.run(
          newSaleId,
          item.product.id,
          item.product.name,
          item.product.barcode,
          item.product.sku,
          item.product.unit,
          item.quantity,
          item.product.selling_price_minor,
          item.product.purchase_price_minor,
          item.lineSubtotalMinor
        );

        const stockBefore = item.product.stock_qty;
        const stockAfter = stockBefore - item.quantity;
        updateStock.run(stockAfter, item.product.id);
        insertMovement.run(
          item.product.id,
          -item.quantity,
          stockBefore,
          stockAfter,
          newSaleId,
          `Sale ${receiptNumber}`,
          cashierName
        );
      }

      this.db
        .prepare(
          `INSERT INTO payments (sale_id, method, amount_minor, reference)
           VALUES (?, ?, ?, ?)`
        )
        .run(newSaleId, paymentMethod, totals.totalMinor, input.payment_reference ?? '');

      recordAuditLog(this.db, {
        action: 'SALE_COMPLETED',
        entityType: 'sale',
        entityId: newSaleId,
        actor: cashierName,
        details: {
          receipt_number: receiptNumber,
          total_minor: totals.totalMinor,
          payment_method: paymentMethod,
          item_count: resolvedItems.length,
        },
      });

      return newSaleId;
    })();

    return this.getById(saleId);
  }

  public processRefund(
    saleId: number,
    input: {
      reason: string;
      refund_method?: PaymentMethod;
      restock_items?: boolean;
      processed_by?: string;
      items: Array<{ sale_item_id: number; quantity: number }>;
    }
  ): { sale: SaleDTO; refund: RefundDTO } {
    const result = this.db.transaction(() => {
      const sale = this.db
        .prepare('SELECT * FROM sales WHERE id = ?')
        .get(saleId) as SaleDTO | undefined;

      if (!sale) {
        throw new NotFoundError('Sale transaction not found');
      }
      if (sale.status === 'refunded') {
        throw new AppError('This sale has already been fully refunded', 400, 'ALREADY_REFUNDED');
      }

      const saleItems = this.db
        .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
        .all(saleId) as SaleItemDTO[];

      const itemById = new Map(saleItems.map((si) => [si.id, si]));
      const restock = input.restock_items !== false;
      const actor = input.processed_by ?? 'Store Manager';
      const refundMethod = input.refund_method ?? sale.payment_method;

      let subtotalRefundMinor = 0;
      const resolvedRefundLines: Array<{
        saleItem: SaleItemDTO;
        qty: number;
        lineRefundMinor: number;
      }> = [];

      for (const reqItem of input.items) {
        const si = itemById.get(reqItem.sale_item_id);
        if (!si) {
          throw new AppError(
            `Sale item #${reqItem.sale_item_id} does not belong to sale #${saleId}`,
            400,
            'INVALID_SALE_ITEM'
          );
        }

        const remainingRefundable = si.quantity - si.refunded_qty;
        if (reqItem.quantity > remainingRefundable) {
          throw new AppError(
            `Cannot refund ${reqItem.quantity} of "${si.product_name}". Remaining refundable quantity: ${remainingRefundable}.`,
            400,
            'EXCESS_REFUND_QUANTITY'
          );
        }

        // Proportional net price per unit after original sale discount
        const discountRatio =
          sale.subtotal_minor > 0
            ? (sale.subtotal_minor - sale.discount_amount_minor) / sale.subtotal_minor
            : 1;
        const effectiveTotalPaidRatio =
          sale.subtotal_minor > 0 ? sale.total_minor / sale.subtotal_minor : 1;

        // Calculate proportional refund amount based on total_minor paid for those items
        const rawLine = si.unit_price_minor * reqItem.quantity;
        const lineRefundMinor = Math.round(rawLine * effectiveTotalPaidRatio);
        const netLineBeforeTax = Math.round(rawLine * discountRatio);

        subtotalRefundMinor += netLineBeforeTax;
        resolvedRefundLines.push({
          saleItem: si,
          qty: reqItem.quantity,
          lineRefundMinor,
        });
      }

      const totalRefundMinor = resolvedRefundLines.reduce(
        (acc, l) => acc + l.lineRefundMinor,
        0
      );
      const taxRefundMinor = Math.max(0, totalRefundMinor - subtotalRefundMinor);
      const refundNumber = this.generateReceiptNumber('RFD');

      const rfdInfo = this.db
        .prepare(
          `INSERT INTO refunds (
            refund_number, sale_id, reason, total_refund_minor, tax_refund_minor,
            refund_method, restock_items, processed_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          refundNumber,
          saleId,
          input.reason,
          totalRefundMinor,
          taxRefundMinor,
          refundMethod,
          restock ? 1 : 0,
          actor
        );

      const refundId = Number(rfdInfo.lastInsertRowid);

      const insertRefundItem = this.db.prepare(
        `INSERT INTO refund_items (
          refund_id, sale_item_id, product_id, quantity, unit_price_minor, refund_amount_minor
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );

      const updateSaleItemRefunded = this.db.prepare(
        `UPDATE sale_items SET refunded_qty = refunded_qty + ? WHERE id = ?`
      );

      for (const line of resolvedRefundLines) {
        insertRefundItem.run(
          refundId,
          line.saleItem.id,
          line.saleItem.product_id,
          line.qty,
          line.saleItem.unit_price_minor,
          line.lineRefundMinor
        );
        updateSaleItemRefunded.run(line.qty, line.saleItem.id);

        if (restock) {
          const prod = this.db
            .prepare('SELECT stock_qty FROM products WHERE id = ?')
            .get(line.saleItem.product_id) as { stock_qty: number } | undefined;

          if (prod) {
            const stockBefore = prod.stock_qty;
            const stockAfter = stockBefore + line.qty;
            this.db
              .prepare(`UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`)
              .run(stockAfter, line.saleItem.product_id);

            this.db
              .prepare(
                `INSERT INTO inventory_movements (
                  product_id, movement_type, quantity_delta, stock_before, stock_after,
                  reference_type, reference_id, reason, performed_by
                ) VALUES (?, 'refund_restock', ?, ?, ?, 'refund', ?, ?, ?)`
              )
              .run(
                line.saleItem.product_id,
                line.qty,
                stockBefore,
                stockAfter,
                refundId,
                `Refund ${refundNumber} for ${sale.receipt_number}: ${input.reason}`,
                actor
              );
          }
        }
      }

      // Determine updated sale status
      const updatedItems = this.db
        .prepare('SELECT quantity, refunded_qty FROM sale_items WHERE sale_id = ?')
        .all(saleId) as Array<{ quantity: number; refunded_qty: number }>;

      const allRefunded = updatedItems.every((i) => i.refunded_qty >= i.quantity);
      const newStatus = allRefunded ? 'refunded' : 'partially_refunded';

      this.db.prepare(`UPDATE sales SET status = ? WHERE id = ?`).run(newStatus, saleId);

      recordAuditLog(this.db, {
        action: 'SALE_REFUNDED',
        entityType: 'refund',
        entityId: refundId,
        actor,
        details: {
          refund_number: refundNumber,
          sale_id: saleId,
          receipt_number: sale.receipt_number,
          total_refund_minor: totalRefundMinor,
          restock,
          reason: input.reason,
        },
      });

      const updatedSale = this.getById(saleId);
      const refund = updatedSale.refunds?.find((r) => r.id === refundId)!;
      return { sale: updatedSale, refund };
    })();

    return result;
  }
}
