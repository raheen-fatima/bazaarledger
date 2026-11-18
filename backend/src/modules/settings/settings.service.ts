import type Database from 'better-sqlite3';
import type { AppSettings, PaperWidth, PaymentMethod } from '../../../../shared/types.ts';
import { DEFAULT_SETTINGS_ENTRIES } from '../../migrations/index.ts';
import { recordAuditLog } from '../../utils/audit.ts';

export class SettingsService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;

    const map: Record<string, string> = { ...DEFAULT_SETTINGS_ENTRIES };
    for (const row of rows) {
      map[row.key] = row.value;
    }

    return {
      shop_name: map.shop_name,
      shop_address: map.shop_address,
      shop_phone: map.shop_phone,
      shop_tax_id: map.shop_tax_id,
      currency_code: map.currency_code,
      currency_symbol: map.currency_symbol,
      tax_rate_bps: Number(map.tax_rate_bps) || 0,
      tax_inclusive: map.tax_inclusive === 'true',
      tax_label: map.tax_label,
      receipt_header: map.receipt_header,
      receipt_footer: map.receipt_footer,
      receipt_paper_width: (map.receipt_paper_width as PaperWidth) || '80mm',
      default_payment_method: (map.default_payment_method as PaymentMethod) || 'cash',
      allow_negative_inventory: map.allow_negative_inventory === 'true',
      default_cashier_name: map.default_cashier_name,
    };
  }

  public updateSettings(patch: Partial<AppSettings>): AppSettings {
    const upsert = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);

    const apply = this.db.transaction(() => {
      for (const [key, val] of Object.entries(patch)) {
        if (val !== undefined) {
          upsert.run(key, String(val));
        }
      }
      recordAuditLog(this.db, {
        action: 'SETTINGS_UPDATED',
        entityType: 'settings',
        details: patch as Record<string, unknown>,
      });
    });

    apply();
    return this.getSettings();
  }
}
