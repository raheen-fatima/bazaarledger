import type Database from 'better-sqlite3';

export function recordAuditLog(
  db: Database.Database,
  params: {
    action: string;
    entityType: string;
    entityId?: number | null;
    details?: Record<string, unknown>;
    actor?: string;
  }
): void {
  db.prepare(
    `INSERT INTO audit_logs (action, entity_type, entity_id, details_json, actor)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    params.action,
    params.entityType,
    params.entityId ?? null,
    JSON.stringify(params.details ?? {}),
    params.actor ?? 'Store Operator'
  );
}
