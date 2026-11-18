import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getConfig } from '../../config/env.ts';
import { AppError } from '../../utils/errors.ts';
import { recordAuditLog } from '../../utils/audit.ts';

export const BACKUP_FORMAT_VERSION = 1;

const backupSchema = z.object({
  app: z.literal('BazaarLedger POS'),
  schema_version: z.literal(BACKUP_FORMAT_VERSION),
  exported_at: z.string().min(1),
  data: z.object({
    categories: z.array(z.record(z.string(), z.unknown())),
    products: z.array(z.record(z.string(), z.unknown())),
    customers: z.array(z.record(z.string(), z.unknown())),
    sales: z.array(z.record(z.string(), z.unknown())),
    sale_items: z.array(z.record(z.string(), z.unknown())),
    payments: z.array(z.record(z.string(), z.unknown())),
    inventory_movements: z.array(z.record(z.string(), z.unknown())),
    stock_adjustments: z.array(z.record(z.string(), z.unknown())),
    refunds: z.array(z.record(z.string(), z.unknown())),
    refund_items: z.array(z.record(z.string(), z.unknown())),
    settings: z.array(z.record(z.string(), z.unknown())),
    audit_logs: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  }),
});

export type BackupPayload = z.infer<typeof backupSchema>;

export class BackupService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public exportBackup(): BackupPayload {
    const readSnapshot = this.db.transaction(() => {
      return {
        app: 'BazaarLedger POS' as const,
        schema_version: BACKUP_FORMAT_VERSION as 1,
        exported_at: new Date().toISOString(),
        data: {
          categories: this.db.prepare('SELECT * FROM categories ORDER BY id ASC').all() as Record<string, unknown>[],
          products: this.db.prepare('SELECT * FROM products ORDER BY id ASC').all() as Record<string, unknown>[],
          customers: this.db.prepare('SELECT * FROM customers ORDER BY id ASC').all() as Record<string, unknown>[],
          sales: this.db.prepare('SELECT * FROM sales ORDER BY id ASC').all() as Record<string, unknown>[],
          sale_items: this.db.prepare('SELECT * FROM sale_items ORDER BY id ASC').all() as Record<string, unknown>[],
          payments: this.db.prepare('SELECT * FROM payments ORDER BY id ASC').all() as Record<string, unknown>[],
          inventory_movements: this.db.prepare('SELECT * FROM inventory_movements ORDER BY id ASC').all() as Record<string, unknown>[],
          stock_adjustments: this.db.prepare('SELECT * FROM stock_adjustments ORDER BY id ASC').all() as Record<string, unknown>[],
          refunds: this.db.prepare('SELECT * FROM refunds ORDER BY id ASC').all() as Record<string, unknown>[],
          refund_items: this.db.prepare('SELECT * FROM refund_items ORDER BY id ASC').all() as Record<string, unknown>[],
          settings: this.db.prepare('SELECT * FROM settings ORDER BY key ASC').all() as Record<string, unknown>[],
          audit_logs: this.db.prepare('SELECT * FROM audit_logs ORDER BY id ASC').all() as Record<string, unknown>[],
        },
      };
    });

    return readSnapshot();
  }

  public saveSafetyBackupToDisk(): string | null {
    const cfg = getConfig();
    if (cfg.dbPath === ':memory:') {
      return null;
    }

    const snapshot = this.exportBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `safety-backup-${stamp}.json`;
    const filePath = path.join(cfg.backupDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    return filePath;
  }

  public listSafetyBackups(): Array<{
    filename: string;
    size_bytes: number;
    created_at: string;
  }> {
    const cfg = getConfig();
    if (cfg.dbPath === ':memory:' || !fs.existsSync(cfg.backupDir)) {
      return [];
    }

    return fs
      .readdirSync(cfg.backupDir)
      .filter((f) => f.endsWith('.json'))
      .map((filename) => {
        const stat = fs.statSync(path.join(cfg.backupDir, filename));
        return {
          filename,
          size_bytes: stat.size,
          created_at: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  public restoreBackup(rawPayload: unknown): {
    safety_backup_path: string | null;
    restored_counts: Record<string, number>;
  } {
    const parsed = backupSchema.safeParse(rawPayload);
    if (!parsed.success) {
      throw new AppError(
        'Invalid or corrupted backup file structure',
        400,
        'INVALID_BACKUP',
        parsed.error.issues.slice(0, 5)
      );
    }

    const backup = parsed.data;
    const safetyBackupPath = this.saveSafetyBackupToDisk();

    try {
      const counts = this.db.transaction(() => {
        // Delete in reverse foreign-key dependency order
        this.db.prepare('DELETE FROM refund_items').run();
        this.db.prepare('DELETE FROM refunds').run();
        this.db.prepare('DELETE FROM payments').run();
        this.db.prepare('DELETE FROM sale_items').run();
        this.db.prepare('DELETE FROM sales').run();
        this.db.prepare('DELETE FROM stock_adjustments').run();
        this.db.prepare('DELETE FROM inventory_movements').run();
        this.db.prepare('DELETE FROM products').run();
        this.db.prepare('DELETE FROM categories').run();
        this.db.prepare('DELETE FROM customers').run();
        this.db.prepare('DELETE FROM settings').run();
        this.db.prepare('DELETE FROM audit_logs').run();

        const insertCategory = this.db.prepare(
          `INSERT INTO categories (id, name, description, color, is_active, created_at, updated_at)
           VALUES (@id, @name, @description, @color, @is_active, @created_at, @updated_at)`
        );
        for (const row of backup.data.categories) insertCategory.run(row);

        const insertProduct = this.db.prepare(
          `INSERT INTO products (
            id, name, barcode, sku, category_id, purchase_price_minor, selling_price_minor,
            stock_qty, min_stock_threshold, unit, description, is_active, created_at, updated_at
          ) VALUES (
            @id, @name, @barcode, @sku, @category_id, @purchase_price_minor, @selling_price_minor,
            @stock_qty, @min_stock_threshold, @unit, @description, @is_active, @created_at, @updated_at
          )`
        );
        for (const row of backup.data.products) insertProduct.run(row);

        const insertCustomer = this.db.prepare(
          `INSERT INTO customers (id, name, phone, email, address, notes, is_active, created_at, updated_at)
           VALUES (@id, @name, @phone, @email, @address, @notes, @is_active, @created_at, @updated_at)`
        );
        for (const row of backup.data.customers) insertCustomer.run(row);

        const insertSale = this.db.prepare(
          `INSERT INTO sales (
            id, receipt_number, idempotency_key, customer_id, cashier_name,
            subtotal_minor, discount_type, discount_value, discount_amount_minor,
            tax_rate_bps, tax_amount_minor, total_minor, paid_minor, change_minor,
            payment_method, status, notes, created_at
          ) VALUES (
            @id, @receipt_number, @idempotency_key, @customer_id, @cashier_name,
            @subtotal_minor, @discount_type, @discount_value, @discount_amount_minor,
            @tax_rate_bps, @tax_amount_minor, @total_minor, @paid_minor, @change_minor,
            @payment_method, @status, @notes, @created_at
          )`
        );
        for (const row of backup.data.sales) insertSale.run(row);

        const insertSaleItem = this.db.prepare(
          `INSERT INTO sale_items (
            id, sale_id, product_id, product_name, barcode, sku, unit,
            quantity, unit_price_minor, purchase_price_minor, line_subtotal_minor, refunded_qty
          ) VALUES (
            @id, @sale_id, @product_id, @product_name, @barcode, @sku, @unit,
            @quantity, @unit_price_minor, @purchase_price_minor, @line_subtotal_minor, @refunded_qty
          )`
        );
        for (const row of backup.data.sale_items) insertSaleItem.run(row);

        const insertPayment = this.db.prepare(
          `INSERT INTO payments (id, sale_id, method, amount_minor, reference, created_at)
           VALUES (@id, @sale_id, @method, @amount_minor, @reference, @created_at)`
        );
        for (const row of backup.data.payments) insertPayment.run(row);

        const insertMov = this.db.prepare(
          `INSERT INTO inventory_movements (
            id, product_id, movement_type, quantity_delta, stock_before, stock_after,
            reference_type, reference_id, reason, performed_by, created_at
          ) VALUES (
            @id, @product_id, @movement_type, @quantity_delta, @stock_before, @stock_after,
            @reference_type, @reference_id, @reason, @performed_by, @created_at
          )`
        );
        for (const row of backup.data.inventory_movements) insertMov.run(row);

        const insertAdj = this.db.prepare(
          `INSERT INTO stock_adjustments (
            id, product_id, adjustment_type, quantity_delta, reason, authorized_by, notes, created_at
          ) VALUES (
            @id, @product_id, @adjustment_type, @quantity_delta, @reason, @authorized_by, @notes, @created_at
          )`
        );
        for (const row of backup.data.stock_adjustments) insertAdj.run(row);

        const insertRefund = this.db.prepare(
          `INSERT INTO refunds (
            id, refund_number, sale_id, reason, total_refund_minor, tax_refund_minor,
            refund_method, restock_items, processed_by, created_at
          ) VALUES (
            @id, @refund_number, @sale_id, @reason, @total_refund_minor, @tax_refund_minor,
            @refund_method, @restock_items, @processed_by, @created_at
          )`
        );
        for (const row of backup.data.refunds) insertRefund.run(row);

        const insertRefundItem = this.db.prepare(
          `INSERT INTO refund_items (
            id, refund_id, sale_item_id, product_id, quantity, unit_price_minor, refund_amount_minor
          ) VALUES (
            @id, @refund_id, @sale_item_id, @product_id, @quantity, @unit_price_minor, @refund_amount_minor
          )`
        );
        for (const row of backup.data.refund_items) insertRefundItem.run(row);

        const insertSetting = this.db.prepare(
          `INSERT INTO settings (key, value, updated_at)
           VALUES (@key, @value, @updated_at)`
        );
        for (const row of backup.data.settings) insertSetting.run(row);

        const insertAudit = this.db.prepare(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, details_json, actor, created_at)
           VALUES (@id, @action, @entity_type, @entity_id, @details_json, @actor, @created_at)`
        );
        for (const row of backup.data.audit_logs ?? []) insertAudit.run(row);

        recordAuditLog(this.db, {
          action: 'BACKUP_RESTORED',
          entityType: 'system',
          details: {
            backup_exported_at: backup.exported_at,
            safety_backup_path: safetyBackupPath,
          },
        });

        return {
          categories: backup.data.categories.length,
          products: backup.data.products.length,
          customers: backup.data.customers.length,
          sales: backup.data.sales.length,
          inventory_movements: backup.data.inventory_movements.length,
          refunds: backup.data.refunds.length,
        };
      })();

      return {
        safety_backup_path: safetyBackupPath,
        restored_counts: counts,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        'Backup restoration failed due to inconsistent or corrupt records. No changes were applied.',
        400,
        'BACKUP_RESTORE_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
