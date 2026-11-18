import type Database from 'better-sqlite3';
import type { InventoryMovementDTO, ProductDTO } from '../../../../shared/types.ts';
import { AppError, InsufficientStockError, NotFoundError } from '../../utils/errors.ts';
import { recordAuditLog } from '../../utils/audit.ts';
import { SettingsService } from '../settings/settings.service.ts';

export class InventoryService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public getMovements(query: {
    product_id?: number;
    movement_type?: string;
    page?: number;
    page_size?: number;
  }): {
    items: InventoryMovementDTO[];
    total: number;
    page: number;
    page_size: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.product_id) {
      conditions.push('im.product_id = ?');
      params.push(query.product_id);
    }
    if (query.movement_type && query.movement_type !== 'all') {
      conditions.push('im.movement_type = ?');
      params.push(query.movement_type);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.page_size ?? 30));
    const offset = (page - 1) * pageSize;

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM inventory_movements im ${whereSql}`)
      .get(...params) as { cnt: number };

    const items = this.db
      .prepare(
        `SELECT im.*, p.name as product_name, p.barcode as product_barcode, p.sku as product_sku
         FROM inventory_movements im
         JOIN products p ON p.id = im.product_id
         ${whereSql}
         ORDER BY im.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as InventoryMovementDTO[];

    return { items, total: totalRow.cnt, page, page_size: pageSize };
  }

  public getLowStockProducts(): ProductDTO[] {
    return this.db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1 AND p.stock_qty <= p.min_stock_threshold
         ORDER BY p.stock_qty ASC, p.name ASC`
      )
      .all() as ProductDTO[];
  }

  public adjustStock(input: {
    product_id: number;
    adjustment_type: 'add' | 'remove' | 'set';
    quantity: number;
    reason: string;
    authorized_by?: string;
    notes?: string;
    allow_negative_override?: boolean;
  }): {
    product: ProductDTO;
    movement: InventoryMovementDTO;
  } {
    const settings = new SettingsService(this.db).getSettings();

    const result = this.db.transaction(() => {
      const product = this.db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(input.product_id) as ProductDTO | undefined;

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      const stockBefore = product.stock_qty;
      let stockAfter = stockBefore;
      let delta = 0;

      if (input.adjustment_type === 'add') {
        if (input.quantity <= 0) {
          throw new AppError('Quantity to add must be greater than zero', 400, 'INVALID_QUANTITY');
        }
        delta = input.quantity;
        stockAfter = stockBefore + delta;
      } else if (input.adjustment_type === 'remove') {
        if (input.quantity <= 0) {
          throw new AppError('Quantity to remove must be greater than zero', 400, 'INVALID_QUANTITY');
        }
        delta = -input.quantity;
        stockAfter = stockBefore + delta;
      } else if (input.adjustment_type === 'set') {
        stockAfter = input.quantity;
        delta = stockAfter - stockBefore;
        if (delta === 0) {
          throw new AppError('New stock quantity matches current stock', 400, 'NO_CHANGE');
        }
      }

      const canGoNegative = settings.allow_negative_inventory || input.allow_negative_override;
      if (stockAfter < 0 && !canGoNegative) {
        throw new InsufficientStockError(
          `Cannot reduce stock below zero for "${product.name}". Available: ${stockBefore}, attempted delta: ${delta}.`,
          { available: stockBefore, requested_after: stockAfter }
        );
      }

      const actor = input.authorized_by ?? 'Store Manager';
      const adjInfo = this.db
        .prepare(
          `INSERT INTO stock_adjustments (
            product_id, adjustment_type, quantity_delta, reason, authorized_by, notes
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          product.id,
          input.adjustment_type,
          delta,
          input.reason,
          actor,
          input.notes ?? ''
        );

      const adjId = Number(adjInfo.lastInsertRowid);

      this.db
        .prepare(`UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(stockAfter, product.id);

      const movementType =
        input.adjustment_type === 'add'
          ? 'restock'
          : delta >= 0
            ? 'adjustment_in'
            : 'adjustment_out';

      const movInfo = this.db
        .prepare(
          `INSERT INTO inventory_movements (
            product_id, movement_type, quantity_delta, stock_before, stock_after,
            reference_type, reference_id, reason, performed_by
          ) VALUES (?, ?, ?, ?, ?, 'adjustment', ?, ?, ?)`
        )
        .run(
          product.id,
          movementType,
          delta,
          stockBefore,
          stockAfter,
          adjId,
          input.reason,
          actor
        );

      recordAuditLog(this.db, {
        action: 'STOCK_ADJUSTED',
        entityType: 'product',
        entityId: product.id,
        actor,
        details: {
          adjustment_type: input.adjustment_type,
          stock_before: stockBefore,
          stock_after: stockAfter,
          delta,
          reason: input.reason,
        },
      });

      const updatedProduct = this.db
        .prepare(
          `SELECT p.*, c.name as category_name
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.id = ?`
        )
        .get(product.id) as ProductDTO;

      const movement = this.db
        .prepare(
          `SELECT im.*, p.name as product_name, p.barcode as product_barcode, p.sku as product_sku
           FROM inventory_movements im JOIN products p ON p.id = im.product_id
           WHERE im.id = ?`
        )
        .get(Number(movInfo.lastInsertRowid)) as InventoryMovementDTO;

      return { product: updatedProduct, movement };
    })();

    return result;
  }
}
