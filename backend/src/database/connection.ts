import Database from 'better-sqlite3';
import { getConfig } from '../config/env.ts';

let dbInstance: Database.Database | null = null;

export function createDatabaseConnection(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? getConfig().dbPath;
  const db = new Database(resolvedPath);

  // Enforce foreign keys and reliable WAL journaling for concurrent local access
  db.pragma('foreign_keys = ON');
  if (resolvedPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = createDatabaseConnection();
  }
  return dbInstance;
}

export function setDbForTesting(db: Database.Database | null): void {
  if (dbInstance && dbInstance !== db) {
    try {
      dbInstance.close();
    } catch {
      // ignore if already closed
    }
  }
  dbInstance = db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
