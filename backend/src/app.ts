import express from 'express';
import type Database from 'better-sqlite3';
import { createApiRouter } from './routes/api.ts';
import { errorHandler } from './middleware/errorHandler.ts';

export function createApiApp(db: Database.Database): express.Express {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', createApiRouter(db));
  app.use('/api', (_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'API_ROUTE_NOT_FOUND',
        message: 'API endpoint not found',
      },
    });
  });
  app.use(errorHandler);
  return app;
}
