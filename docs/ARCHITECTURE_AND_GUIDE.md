# BazaarLedger POS & Inventory Management System

## Overview
BazaarLedger POS is an offline-first supermarket Point of Sale and Inventory Management System running locally on Node.js, Express, React, Ant Design, and SQLite (`better-sqlite3`). All business records remain stored locally on disk with zero external cloud dependencies.

## Directory Structure
```
.
├── backend/
│   └── src/
│       ├── app.ts                    # Express application factory (testable)
│       ├── config/env.ts             # Local storage & server port configuration
│       ├── database/connection.ts    # SQLite WAL + foreign-key connection manager
│       ├── middleware/errorHandler.ts
│       ├── migrations/index.ts       # Versioned schema migrations & initial seed
│       ├── modules/                  # Domain services (products, categories, inventory, sales, customers, reports, settings, backup)
│       ├── routes/api.ts             # REST API endpoints (/api/*)
│       ├── utils/                    # Typed errors & audit logging
│       └── validators/schemas.ts     # Zod request validation schemas
├── shared/
│   ├── money.ts                      # Fixed-precision integer currency & tax math
│   └── types.ts                      # Shared TypeScript DTOs
├── src/
│   ├── components/ReceiptView.tsx    # Thermal (58mm/80mm) & A4 receipt printer view
│   ├── layouts/MainLayout.tsx        # 10-module Ant Design enterprise shell
│   ├── pages/                        # All 10 operational modules
│   ├── services/api.ts               # Typed REST client
│   ├── stores/posStore.ts            # Zustand cashier cart & hold/resume state
│   └── utils/currency.ts             # Currency formatting & CSV export
├── tests/                            # Vitest + Supertest + React Testing Library suite
├── data/                             # Local SQLite DB & pre-restore safety backups (auto-created)
└── server.ts                         # Unified local HTTP + Vite/static entry point
```

## Installation & Startup

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode
```bash
npm run dev
```
Starts the Express backend and Vite frontend together on `http://localhost:3000`.

### 3. Production Build & Run
```bash
npm run build
npm start
```
Builds the static frontend into `dist/` and runs `node server.ts` on port `3000`.

## Database Storage Location
- **Primary SQLite Database**: `./data/pos.sqlite` (with WAL files `pos.sqlite-wal` / `pos.sqlite-shm`).
- **Pre-Restore Safety Backups**: `./data/backups/safety-backup-<timestamp>.json`.
- You can override the storage folder via `POS_DATA_DIR` or `POS_DB_PATH`.

## Backup & Restore Instructions
1. Open **Backup & Restore** in the sidebar.
2. Click **Download Full JSON Backup (v1)** to save a complete snapshot of categories, products, customers, sales, refunds, inventory movements, settings, and audit logs.
3. To restore, click **Select Backup File to Restore**, verify the record counts in the confirmation dialog, and confirm. A pre-restore safety snapshot is automatically written to `./data/backups/` before the atomic SQLite restoration executes.

## Testing
```bash
npm test
npm run lint
npm run build
```

## Troubleshooting
- **Database locked or busy**: Ensure only one instance of `server.ts` is accessing `./data/pos.sqlite` at a time. SQLite is configured with `busy_timeout = 5000` and `WAL` mode.
- **Thermal printer margins**: In the browser print dialog, disable headers/footers and set margins to "None" or "Minimum" when printing 58mm or 80mm thermal slips.
- **Electron Packaging Ready**: All business logic, SQLite access, and migrations reside cleanly inside `backend/src/` and `shared/`, allowing an Electron main process to import `createApiApp` or run `server.ts` locally without rewriting application code.
