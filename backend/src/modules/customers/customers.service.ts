import type Database from 'better-sqlite3';
import type { CustomerDTO, SaleDTO } from '../../../../shared/types.ts';
import { ConflictError, NotFoundError } from '../../utils/errors.ts';
import { recordAuditLog } from '../../utils/audit.ts';

export class CustomersService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public list(search?: string): CustomerDTO[] {
    const conditions: string[] = ['c.is_active = 1'];
    const params: unknown[] = [];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
      params.push(term, term, term);
    }

    return this.db
      .prepare(
        `SELECT c.*,
                COALESCE(COUNT(s.id), 0) as visit_count,
                COALESCE(SUM(s.total_minor), 0) as total_spent_minor
         FROM customers c
         LEFT JOIN sales s ON s.customer_id = c.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY c.id
         ORDER BY c.name ASC`
      )
      .all(...params) as CustomerDTO[];
  }

  public getById(id: number): CustomerDTO {
    const row = this.db
      .prepare(
        `SELECT c.*,
                COALESCE(COUNT(s.id), 0) as visit_count,
                COALESCE(SUM(s.total_minor), 0) as total_spent_minor
         FROM customers c
         LEFT JOIN sales s ON s.customer_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`
      )
      .get(id) as CustomerDTO | undefined;
    if (!row) {
      throw new NotFoundError('Customer not found');
    }
    return row;
  }

  public getCustomerSales(customerId: number): SaleDTO[] {
    this.getById(customerId);
    return this.db
      .prepare(
        `SELECT s.*, c.name as customer_name, c.phone as customer_phone
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.customer_id = ?
         ORDER BY s.id DESC`
      )
      .all(customerId) as SaleDTO[];
  }

  public create(input: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string;
    notes?: string;
    is_active?: boolean;
  }): CustomerDTO {
    const normalizedPhone = input.phone?.trim() || null;
    const normalizedEmail = input.email?.trim() || null;

    if (normalizedPhone) {
      const dup = this.db
        .prepare('SELECT id, name FROM customers WHERE phone = ?')
        .get(normalizedPhone) as { id: number; name: string } | undefined;
      if (dup) {
        throw new ConflictError(`Phone number "${normalizedPhone}" belongs to ${dup.name}`);
      }
    }

    const info = this.db
      .prepare(
        `INSERT INTO customers (name, phone, email, address, notes, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        normalizedPhone,
        normalizedEmail,
        input.address ?? '',
        input.notes ?? '',
        input.is_active === false ? 0 : 1
      );

    const id = Number(info.lastInsertRowid);
    recordAuditLog(this.db, {
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: id,
      details: { name: input.name, phone: normalizedPhone },
    });

    return this.getById(id);
  }

  public update(
    id: number,
    input: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      address?: string;
      notes?: string;
      is_active?: boolean;
    }
  ): CustomerDTO {
    const existing = this.getById(id);
    const normalizedPhone =
      input.phone !== undefined ? input.phone?.trim() || null : existing.phone;
    const normalizedEmail =
      input.email !== undefined ? input.email?.trim() || null : existing.email;

    if (normalizedPhone && normalizedPhone !== existing.phone) {
      const dup = this.db
        .prepare('SELECT id, name FROM customers WHERE phone = ? AND id != ?')
        .get(normalizedPhone, id) as { id: number; name: string } | undefined;
      if (dup) {
        throw new ConflictError(`Phone number "${normalizedPhone}" belongs to ${dup.name}`);
      }
    }

    this.db
      .prepare(
        `UPDATE customers SET
          name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        input.name ?? existing.name,
        normalizedPhone,
        normalizedEmail,
        input.address ?? existing.address,
        input.notes ?? existing.notes,
        input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
        id
      );

    recordAuditLog(this.db, {
      action: 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: id,
      details: input as Record<string, unknown>,
    });

    return this.getById(id);
  }
}
