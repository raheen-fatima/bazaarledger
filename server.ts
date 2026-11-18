import path from 'node:path';
import express from 'express';
import { getConfig } from './backend/src/config/env.ts';
import { getDb } from './backend/src/database/connection.ts';
import { runMigrations, seedInitialCatalogIfEmpty } from './backend/src/migrations/index.ts';
import { createApiApp } from './backend/src/app.ts';

async function startServer(): Promise<void> {
  const config = getConfig();
  const db = getDb();
  runMigrations(db);
  seedInitialCatalogIfEmpty(db);

  const app = createApiApp(db);

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[BazaarLedger POS] Server running at http://localhost:${config.port} (SQLite: ${config.dbPath})`
    );
  });
}

startServer().catch((err) => {
  console.error('[BazaarLedger POS] Failed to start server:', err);
  process.exit(1);
});
