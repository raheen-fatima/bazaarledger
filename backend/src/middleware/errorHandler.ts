import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.ts';

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>
): void {
  res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0]?.message ?? 'Invalid request payload',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // SQLite constraint errors
  const sqliteErr = err as { code?: string; message?: string };
  if (sqliteErr?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    res.status(409).json({
      success: false,
      error: {
        code: 'UNIQUE_CONSTRAINT',
        message: 'A record with this unique value already exists.',
        details: sqliteErr.message,
      },
    });
    return;
  }

  if (sqliteErr?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    res.status(409).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_CONSTRAINT',
        message: 'Cannot complete operation because this record is referenced by existing transactions.',
      },
    });
    return;
  }

  console.error('[API Error]', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred.',
    },
  });
}
