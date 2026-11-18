import type Database from 'better-sqlite3';
import type { ProductDTO } from '../../../../shared/types.ts';
import { AppError, ConflictError, NotFoundError } from '../../utils/errors.ts';
import { recordAuditLog } from '../../utils/audit.ts';

export interface ProductListQuery {
  search?: string;
  category_id?: number;
  status?: 'active' | 'inactive' | 'all' | 'low_stock' | 'out_of_stock';
  sort_by?: 'name' | 'selling_price_minor' | 'stock_qty' | 'created_at' | 'sku';
  sort_dir?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export class ProductsService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public list(query: ProductListQuery): {
    items: ProductDTO[];
    total: number;
    page: number;
    page_size: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const status = query.status ?? 'active';
    if (status === 'active') {
      conditions.push('p.is_active = 1');
    } else if (status === 'inactive') {
      conditions.push('p.is_active = 0');
    } else if (status === 'low_stock') {
      conditions.push('p.is_active = 1 AND p.stock_qty <= p.min_stock_threshold');
    } else if (status === 'out_of_stock') {
      conditions.push('p.is_active = 1 AND p.stock_qty <= 0');
    }

    if (query.category_id) {
      conditions.push('p.category_id = ?');
      params.push(query.category_id);
    }

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push('(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)');
      params.push(term, term, term);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSortColumns: Record<string, string> = {
      name: 'p.name',
      selling_price_minor: 'p.selling_price_minor',
      stock_qty: 'p.stock_qty',
      created_at: 'p.created_at',
      sku: 'p.sku',
    };
    const sortCol = allowedSortColumns[query.sort_by ?? 'name'] ?? 'p.name';
    const sortDir = query.sort_dir === 'desc' ? 'DESC' : 'ASC';

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.page_size ?? 25));
    const offset = (page - 1) * pageSize;

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM products p ${whereSql}`)
      .get(...params) as { cnt: number };

    const items = this.db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         ${whereSql}
         ORDER BY ${sortCol} ${sortDir}
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as ProductDTO[];

    return {
      items,
      total: totalRow.cnt,
      page,
      page_size: pageSize,
    };
  }

  public getById(id: number): ProductDTO {
    const row = this.db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ?`
      )
      .get(id) as ProductDTO | undefined;
    if (!row) {
      throw new NotFoundError('Product not found');
    }
    return row;
  }

  public findByBarcodeOrSku(code: string): ProductDTO | null {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const row = this.db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1 AND (p.barcode = ? OR UPPER(p.sku) = UPPER(?))
         LIMIT 1`
      )
      .get(trimmed, trimmed) as ProductDTO | undefined;
    return row ?? null;
  }

  public create(input: {
    name: string;
    barcode: string;
    sku: string;
    category_id?: number | null;
    purchase_price_minor: number;
    selling_price_minor: number;
    stock_qty?: number;
    min_stock_threshold?: number;
    unit?: string;
    description?: string;
    is_active?: boolean;
  }): ProductDTO {
    const dupBarcode = this.db
      .prepare('SELECT id, name FROM products WHERE barcode = ?')
      .get(input.barcode) as { id: number; name: string } | undefined;
    if (dupBarcode) {
      throw new ConflictError(
        `Barcode "${input.barcode}" is already assigned to "${dupBarcode.name}"`
      );
    }

    const dupSku = this.db
      .prepare('SELECT id, name FROM products WHERE UPPER(sku) = UPPER(?)')
      .get(input.sku) as { id: number; name: string } | undefined;
    if (dupSku) {
      throw new ConflictError(
        `SKU "${input.sku}" is already assigned to "${dupSku.name}"`
      );
    }

    if (input.category_id) {
      const cat = this.db.prepare('SELECT id FROM categories WHERE id = ?').get(input.category_id);
      if (!cat) {
        throw new AppError('Selected category does not exist', 400, 'INVALID_CATEGORY');
      }
    }

    const initialStock = input.stock_qty ?? 0;

    const createdId = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO products (
            name, barcode, sku, category_id, purchase_price_minor, selling_price_minor,
            stock_qty, min_stock_threshold, unit, description, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name,
          input.barcode,
          input.sku,
          input.category_id ?? null,
          input.purchase_price_minor,
          input.selling_price_minor,
          initialStock,
          input.min_stock_threshold ?? 5,
          input.unit ?? 'pcs',
          input.description ?? '',
          input.is_active === false ? 0 : 1
        );

      const newId = Number(info.lastInsertRowid);

      if (initialStock > 0) {
        this.db
          .prepare(
            `INSERT INTO inventory_movements (
              product_id, movement_type, quantity_delta, stock_before, stock_after,
              reference_type, reference_id, reason, performed_by
            ) VALUES (?, 'initial', ?, 0, ?, 'product', ?, 'Initial stock on product creation', 'Store Operator')`
          )
          .run(newId, initialStock, initialStock, newId);
      }

      recordAuditLog(this.db, {
        action: 'PRODUCT_CREATED',
        entityType: 'product',
        entityId: newId,
        details: { name: input.name, barcode: input.barcode, sku: input.sku, initialStock },
      });

      return newId;
    })();

    return this.getById(createdId);
  }

  public update(
    id: number,
    input: {
      name?: string;
      barcode?: string;
      sku?: string;
      category_id?: number | null;
      purchase_price_minor?: number;
      selling_price_minor?: number;
      min_stock_threshold?: number;
      unit?: string;
      description?: string;
      is_active?: boolean;
    }
  ): ProductDTO {
    const existing = this.getById(id);

    if (input.barcode && input.barcode !== existing.barcode) {
      const dup = this.db
        .prepare('SELECT id, name FROM products WHERE barcode = ? AND id != ?')
        .get(input.barcode, id) as { id: number; name: string } | undefined;
      if (dup) {
        throw new ConflictError(
          `Barcode "${input.barcode}" is already assigned to "${dup.name}"`
        );
      }
    }

    if (input.sku && input.sku.toUpperCase() !== existing.sku.toUpperCase()) {
      const dup = this.db
        .prepare('SELECT id, name FROM products WHERE UPPER(sku) = UPPER(?) AND id != ?')
        .get(input.sku, id) as { id: number; name: string } | undefined;
      if (dup) {
        throw new ConflictError(`SKU "${input.sku}" is already assigned to "${dup.name}"`);
      }
    }

    if (input.category_id !== undefined && input.category_id !== null) {
      const cat = this.db.prepare('SELECT id FROM categories WHERE id = ?').get(input.category_id);
      if (!cat) {
        throw new AppError('Selected category does not exist', 400, 'INVALID_CATEGORY');
      }
    }

    this.db
      .prepare(
        `UPDATE products SET
          name = ?,
          barcode = ?,
          sku = ?,
          category_id = ?,
          purchase_price_minor = ?,
          selling_price_minor = ?,
          min_stock_threshold = ?,
          unit = ?,
          description = ?,
          is_active = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        input.name ?? existing.name,
        input.barcode ?? existing.barcode,
        input.sku ?? existing.sku,
        input.category_id !== undefined ? input.category_id : existing.category_id,
        input.purchase_price_minor ?? existing.purchase_price_minor,
        input.selling_price_minor ?? existing.selling_price_minor,
        input.min_stock_threshold ?? existing.min_stock_threshold,
        input.unit ?? existing.unit,
        input.description ?? existing.description,
        input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        id
      );

    recordAuditLog(this.db, {
      action: 'PRODUCT_UPDATED',
      entityType: 'product',
      entityId: id,
      details: input as Record<string, unknown>,
    });

    return this.getById(id);
  }

  public removeOrArchive(id: number): { archived: boolean; deleted: boolean } {
    const existing = this.getById(id);

    const referencedInSales = this.db
      .prepare('SELECT COUNT(*) as cnt FROM sale_items WHERE product_id = ?')
      .get(id) as { cnt: number };

    const referencedInMovements = this.db
      .prepare('SELECT COUNT(*) as cnt FROM inventory_movements WHERE product_id = ?')
      .get(id) as { cnt: number };

    if (referencedInSales.cnt > 0 || referencedInMovements.cnt > 1) {
      this.db
        .prepare(`UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
        .run(id);
      recordAuditLog(this.db, {
        action: 'PRODUCT_ARCHIVED',
        entityType: 'product',
        entityId: id,
        details: { name: existing.name, barcode: existing.barcode },
      });
      return { archived: true, deleted: false };
    }

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM inventory_movements WHERE product_id = ?').run(id);
      this.db.prepare('DELETE FROM stock_adjustments WHERE product_id = ?').run(id);
      this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
      recordAuditLog(this.db, {
        action: 'PRODUCT_DELETED',
        entityType: 'product',
        entityId: id,
        details: { name: existing.name, barcode: existing.barcode },
      });
    })();

    return { archived: false, deleted: true };
  }
}
