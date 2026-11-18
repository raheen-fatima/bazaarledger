import path from 'node:path';
import fs from 'node:fs';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dbPath: string;
  backupDir: string;
}

export function getConfig(): AppConfig {
  const rootDir = process.cwd();
  const dataDir = process.env.POS_DATA_DIR
    ? path.resolve(process.env.POS_DATA_DIR)
    : path.join(rootDir, 'data');

  const dbPath = process.env.POS_DB_PATH
    ? process.env.POS_DB_PATH === ':memory:'
      ? ':memory:'
      : path.resolve(process.env.POS_DB_PATH)
    : path.join(dataDir, 'pos.sqlite');

  const backupDir = path.join(dataDir, 'backups');

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    dbPath,
    backupDir,
  };
}
