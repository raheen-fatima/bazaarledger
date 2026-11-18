import { Router } from 'express';
import type Database from 'better-sqlite3';
import { asyncHandler, sendSuccess } from '../middleware/errorHandler.ts';
import { CategoriesService } from '../modules/categories/categories.service.ts';
import { ProductsService } from '../modules/products/products.service.ts';
import { InventoryService } from '../modules/inventory/inventory.service.ts';
import { CustomersService } from '../modules/customers/customers.service.ts';
import { SalesService } from '../modules/sales/sales.service.ts';
import { ReportsService } from '../modules/reports/reports.service.ts';
import { SettingsService } from '../modules/settings/settings.service.ts';
import { BackupService } from '../modules/backup/backup.service.ts';
import {
  createCategorySchema,
  createCustomerSchema,
  createProductSchema,
  createRefundSchema,
  createSaleSchema,
  stockAdjustmentSchema,
  updateCategorySchema,
  updateCustomerSchema,
  updateProductSchema,
  updateSettingsSchema,
} from '../validators/schemas.ts';
import { AppError } from '../utils/errors.ts';

export function createApiRouter(db: Database.Database): Router {
  const router = Router();

  const categoriesService = new CategoriesService(db);
  const productsService = new ProductsService(db);
  const inventoryService = new InventoryService(db);
  const customersService = new CustomersService(db);
  const salesService = new SalesService(db);
  const reportsService = new ReportsService(db);
  const settingsService = new SettingsService(db);
  const backupService = new BackupService(db);

  // Health
  router.get('/health', (_req, res) => {
    sendSuccess(res, { status: 'ok', database: 'sqlite', timestamp: new Date().toISOString() });
  });

  // Dashboard
  router.get(
    '/dashboard',
    asyncHandler((_req, res) => {
      const summary = reportsService.getDashboardSummary();
      sendSuccess(res, summary);
    })
  );

  // Categories
  router.get(
    '/categories',
    asyncHandler((req, res) => {
      const includeInactive = req.query.include_inactive === 'true';
      sendSuccess(res, categoriesService.list(includeInactive));
    })
  );

  router.post(
    '/categories',
    asyncHandler((req, res) => {
      const body = createCategorySchema.parse(req.body);
      sendSuccess(res, categoriesService.create(body), 201);
    })
  );

  router.patch(
    '/categories/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid category id', 400);
      const body = updateCategorySchema.parse(req.body);
      sendSuccess(res, categoriesService.update(id, body));
    })
  );

  router.delete(
    '/categories/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid category id', 400);
      sendSuccess(res, categoriesService.remove(id));
    })
  );

  // Products
  router.get(
    '/products',
    asyncHandler((req, res) => {
      const result = productsService.list({
        search: req.query.search as string | undefined,
        category_id: req.query.category_id ? Number(req.query.category_id) : undefined,
        status: req.query.status as
          | 'active'
          | 'inactive'
          | 'all'
          | 'low_stock'
          | 'out_of_stock'
          | undefined,
        sort_by: req.query.sort_by as
          | 'name'
          | 'selling_price_minor'
          | 'stock_qty'
          | 'created_at'
          | 'sku'
          | undefined,
        sort_dir: req.query.sort_dir as 'asc' | 'desc' | undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        page_size: req.query.page_size ? Number(req.query.page_size) : 25,
      });
      sendSuccess(res, result);
    })
  );

  router.get(
    '/products/lookup/:code',
    asyncHandler((req, res) => {
      const product = productsService.findByBarcodeOrSku(req.params.code);
      sendSuccess(res, product);
    })
  );

  router.get(
    '/products/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid product id', 400);
      sendSuccess(res, productsService.getById(id));
    })
  );

  router.post(
    '/products',
    asyncHandler((req, res) => {
      const body = createProductSchema.parse(req.body);
      sendSuccess(res, productsService.create(body), 201);
    })
  );

  router.patch(
    '/products/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid product id', 400);
      const body = updateProductSchema.parse(req.body);
      sendSuccess(res, productsService.update(id, body));
    })
  );

  router.delete(
    '/products/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid product id', 400);
      sendSuccess(res, productsService.removeOrArchive(id));
    })
  );

  // Inventory
  router.get(
    '/inventory/movements',
    asyncHandler((req, res) => {
      const result = inventoryService.getMovements({
        product_id: req.query.product_id ? Number(req.query.product_id) : undefined,
        movement_type: req.query.movement_type as string | undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        page_size: req.query.page_size ? Number(req.query.page_size) : 30,
      });
      sendSuccess(res, result);
    })
  );

  router.get(
    '/inventory/low-stock',
    asyncHandler((_req, res) => {
      sendSuccess(res, inventoryService.getLowStockProducts());
    })
  );

  router.post(
    '/inventory/adjustments',
    asyncHandler((req, res) => {
      const body = stockAdjustmentSchema.parse(req.body);
      sendSuccess(res, inventoryService.adjustStock(body), 201);
    })
  );

  // Customers
  router.get(
    '/customers',
    asyncHandler((req, res) => {
      sendSuccess(res, customersService.list(req.query.search as string | undefined));
    })
  );

  router.get(
    '/customers/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid customer id', 400);
      const customer = customersService.getById(id);
      const sales = customersService.getCustomerSales(id);
      sendSuccess(res, { customer, sales });
    })
  );

  router.post(
    '/customers',
    asyncHandler((req, res) => {
      const body = createCustomerSchema.parse(req.body);
      sendSuccess(res, customersService.create(body), 201);
    })
  );

  router.patch(
    '/customers/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid customer id', 400);
      const body = updateCustomerSchema.parse(req.body);
      sendSuccess(res, customersService.update(id, body));
    })
  );

  // Sales & Refunds
  router.get(
    '/sales',
    asyncHandler((req, res) => {
      const result = salesService.list({
        search: req.query.search as string | undefined,
        payment_method: req.query.payment_method as string | undefined,
        status: req.query.status as string | undefined,
        customer_id: req.query.customer_id ? Number(req.query.customer_id) : undefined,
        date_from: req.query.date_from as string | undefined,
        date_to: req.query.date_to as string | undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        page_size: req.query.page_size ? Number(req.query.page_size) : 25,
      });
      sendSuccess(res, result);
    })
  );

  router.get(
    '/sales/:id',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid sale id', 400);
      sendSuccess(res, salesService.getById(id));
    })
  );

  router.post(
    '/sales',
    asyncHandler((req, res) => {
      const body = createSaleSchema.parse(req.body);
      const sale = salesService.createSale(body);
      sendSuccess(res, sale, 201);
    })
  );

  router.post(
    '/sales/:id/refunds',
    asyncHandler((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid sale id', 400);
      const body = createRefundSchema.parse(req.body);
      const result = salesService.processRefund(id, body);
      sendSuccess(res, result, 201);
    })
  );

  // Reports
  router.get(
    '/reports/summary',
    asyncHandler((req, res) => {
      const today = new Date().toISOString().slice(0, 10);
      const from = (req.query.from as string) || today;
      const to = (req.query.to as string) || today;
      sendSuccess(res, reportsService.getSalesReport(from, to));
    })
  );

  // Settings
  router.get(
    '/settings',
    asyncHandler((_req, res) => {
      sendSuccess(res, settingsService.getSettings());
    })
  );

  router.put(
    '/settings',
    asyncHandler((req, res) => {
      const body = updateSettingsSchema.parse(req.body);
      sendSuccess(res, settingsService.updateSettings(body));
    })
  );

  // Backup & Restore
  router.get(
    '/backup/export',
    asyncHandler((_req, res) => {
      const payload = backupService.exportBackup();
      sendSuccess(res, payload);
    })
  );

  router.get(
    '/backup/safety-list',
    asyncHandler((_req, res) => {
      sendSuccess(res, backupService.listSafetyBackups());
    })
  );

  router.post(
    '/backup/restore',
    asyncHandler((req, res) => {
      const result = backupService.restoreBackup(req.body);
      sendSuccess(res, result);
    })
  );

  return router;
}
