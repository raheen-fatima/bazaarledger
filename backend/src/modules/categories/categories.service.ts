import type Database from 'better-sqlite3';
import type { CategoryDTO } from '../../../../shared/types.ts';
import { ConflictError, NotFoundError } from '../../utils/errors.ts';
import { recordAuditLog } from '../../utils/audit.ts';

export class CategoriesService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public list(includeInactive = false): CategoryDTO[] {
    const whereClause = includeInactive ? '' : 'WHERE c.is_active = 1';
    return this.db
      .prepare(
        `SELECT c.*, COUNT(p.id) as product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
         ${whereClause}
         GROUP BY c.id
         ORDER BY c.name ASC`
      )
      .all() as CategoryDTO[];
  }

  public getById(id: number): CategoryDTO {
    const row = this.db
      .prepare(
        `SELECT c.*, COUNT(p.id) as product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
         WHERE c.id = ?
         GROUP BY c.id`
      )
      .get(id) as CategoryDTO | undefined;
    if (!row) {
      throw new NotFoundError('Category not found');
    }
    return row;
  }

  public create(input: {
    name: string;
    description?: string;
    color?: string;
    is_active?: boolean;
  }): CategoryDTO {
    const duplicate = this.db
      .prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)')
      .get(input.name);
    if (duplicate) {
      throw new ConflictError(`Category "${input.name}" already exists`);
    }

    const info = this.db
      .prepare(
        `INSERT INTO categories (name, description, color, is_active)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.description ?? '',
        input.color ?? '#1d4ed8',
        input.is_active === false ? 0 : 1
      );

    const id = Number(info.lastInsertRowid);
    recordAuditLog(this.db, {
      action: 'CATEGORY_CREATED',
      entityType: 'category',
      entityId: id,
      details: { name: input.name },
    });

    return this.getById(id);
  }

  public update(
    id: number,
    input: {
      name?: string;
      description?: string;
      color?: string;
      is_active?: boolean;
    }
  ): CategoryDTO {
    const existing = this.getById(id);

    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = this.db
        .prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?')
        .get(input.name, id);
      if (duplicate) {
        throw new ConflictError(`Category "${input.name}" already exists`);
      }
    }

    this.db
      .prepare(
        `UPDATE categories
         SET name = ?, description = ?, color = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        input.name ?? existing.name,
        input.description ?? existing.description,
        input.color ?? existing.color,
        input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        id
      );

    recordAuditLog(this.db, {
      action: 'CATEGORY_UPDATED',
      entityType: 'category',
      entityId: id,
      details: input as Record<string, unknown>,
    });

    return this.getById(id);
  }

  public remove(id: number): { archived: boolean; deleted: boolean } {
    const existing = this.getById(id);
    const linked = this.db
      .prepare('SELECT COUNT(*) as cnt FROM products WHERE category_id = ?')
      .get(id) as { cnt: number };

    if (linked.cnt > 0) {
      this.db
        .prepare(`UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
        .run(id);
      recordAuditLog(this.db, {
        action: 'CATEGORY_ARCHIVED',
        entityType: 'category',
        entityId: id,
        details: { name: existing.name },
      });
      return { archived: true, deleted: false };
    }

    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    recordAuditLog(this.db, {
      action: 'CATEGORY_DELETED',
      entityType: 'category',
      entityId: id,
      details: { name: existing.name },
    });
    return { archived: false, deleted: true };
  }
}
