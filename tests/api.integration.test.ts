import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { runMigrations } from '../backend/src/migrations/index.ts';
import { createApiApp } from '../backend/src/app.ts';

function setupTestApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const app = createApiApp(db);
  return { db, app };
}

describe('BazaarLedger POS Backend Integration Tests', () => {
  let app: ReturnType<typeof createApiApp>;

  beforeEach(() => {
    const setup = setupTestApp();
    app = setup.app;
  });

  it('manages categories and products with duplicate barcode/SKU prevention', async () => {
    const catRes = await request(app)
      .post('/api/categories')
      .send({ name: 'Beverages', description: 'Drinks', color: '#0891b2' });
    expect(catRes.status).toBe(201);
    const categoryId = catRes.body.data.id;

    const p1 = await request(app).post('/api/products').send({
      name: 'Tapal Tea 450g',
      barcode: '8961002014502',
      sku: 'BEV-3001',
      category_id: categoryId,
      purchase_price_minor: 65000,
      selling_price_minor: 75000,
      stock_qty: 10,
      min_stock_threshold: 3,
      unit: 'pack',
    });
    expect(p1.status).toBe(201);
    expect(p1.body.data.stock_qty).toBe(10);

    // Duplicate barcode check
    const dupBarcode = await request(app).post('/api/products').send({
      name: 'Another Tea',
      barcode: '8961002014502',
      sku: 'BEV-3002',
      purchase_price_minor: 50000,
      selling_price_minor: 60000,
      stock_qty: 5,
    });
    expect(dupBarcode.status).toBe(409);

    // Lookup by barcode & SKU
    const lookup = await request(app).get('/api/products/lookup/BEV-3001');
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.name).toBe('Tapal Tea 450g');
  });

  it('processes atomic sales, deducts stock, prevents duplicates via idempotency, and preserves historical prices', async () => {
    const prodRes = await request(app).post('/api/products').send({
      name: 'Olpers Milk 1L',
      barcode: '8961003021015',
      sku: 'DAI-1001',
      purchase_price_minor: 25000,
      selling_price_minor: 30000,
      stock_qty: 10,
      min_stock_threshold: 2,
      unit: 'L',
    });
    const productId = prodRes.body.data.id;

    // Enable 10% tax in settings
    await request(app).put('/api/settings').send({ tax_rate_bps: 1000, tax_inclusive: false });

    const idempotencyKey = 'checkout-key-0001';
    const salePayload = {
      idempotency_key: idempotencyKey,
      items: [{ product_id: productId, quantity: 3 }],
      discount_type: 'fixed',
      discount_value: 10000, // Rs 100 off 900 -> net 800 + 10% tax (80) = 880 (88000 minor)
      payment_method: 'cash',
      paid_minor: 100000, // Rs 1000 tendered -> change Rs 120 (12000 minor)
    };

    const saleRes = await request(app).post('/api/sales').send(salePayload);
    expect(saleRes.status).toBe(201);
    expect(saleRes.body.data.subtotal_minor).toBe(90000);
    expect(saleRes.body.data.discount_amount_minor).toBe(10000);
    expect(saleRes.body.data.tax_amount_minor).toBe(8000);
    expect(saleRes.body.data.total_minor).toBe(88000);
    expect(saleRes.body.data.change_minor).toBe(12000);

    // Retry with same idempotency key must return same sale and NOT deduct stock again
    const retryRes = await request(app).post('/api/sales').send(salePayload);
    expect(retryRes.status).toBe(201);
    expect(retryRes.body.data.id).toBe(saleRes.body.data.id);

    const updatedProd = await request(app).get(`/api/products/${productId}`);
    expect(updatedProd.body.data.stock_qty).toBe(7);

    // Update product price and verify historical receipt price stays 30000
    await request(app)
      .patch(`/api/products/${productId}`)
      .send({ selling_price_minor: 35000 });
    const historicalSale = await request(app).get(`/api/sales/${saleRes.body.data.id}`);
    expect(historicalSale.body.data.items[0].unit_price_minor).toBe(30000);

    // Insufficient stock check
    const oversellRes = await request(app).post('/api/sales').send({
      idempotency_key: 'checkout-key-0002',
      items: [{ product_id: productId, quantity: 99 }],
      payment_method: 'cash',
      paid_minor: 5000000,
    });
    expect(oversellRes.status).toBe(409);
    expect(oversellRes.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('handles inventory adjustments, negative-stock guard, refunds, and archives sold products safely', async () => {
    const prodRes = await request(app).post('/api/products').send({
      name: 'Basmati Rice 5kg',
      barcode: '8964000125001',
      sku: 'GRN-2001',
      purchase_price_minor: 150000,
      selling_price_minor: 180000,
      stock_qty: 5,
      unit: 'pack',
    });
    const productId = prodRes.body.data.id;

    // Prevent negative stock adjustment without override
    const badAdj = await request(app).post('/api/inventory/adjustments').send({
      product_id: productId,
      adjustment_type: 'remove',
      quantity: 10,
      reason: 'Shrinkage test',
    });
    expect(badAdj.status).toBe(409);

    // Valid restock
    const addAdj = await request(app).post('/api/inventory/adjustments').send({
      product_id: productId,
      adjustment_type: 'add',
      quantity: 5,
      reason: 'Supplier delivery',
    });
    expect(addAdj.status).toBe(201);
    expect(addAdj.body.data.product.stock_qty).toBe(10);

    // Sell 4 units
    const saleRes = await request(app).post('/api/sales').send({
      idempotency_key: 'sale-rice-1',
      items: [{ product_id: productId, quantity: 4 }],
      payment_method: 'card',
      paid_minor: 720000,
    });
    expect(saleRes.status).toBe(201);
    const saleItemId = saleRes.body.data.items[0].id;

    // Partial refund of 2 units with restock
    const refundRes = await request(app)
      .post(`/api/sales/${saleRes.body.data.id}/refunds`)
      .send({
        reason: 'Customer returned 2 bags',
        refund_method: 'cash',
        restock_items: true,
        items: [{ sale_item_id: saleItemId, quantity: 2 }],
      });
    expect(refundRes.status).toBe(201);
    expect(refundRes.body.data.sale.status).toBe('partially_refunded');

    // Stock should now be 10 - 4 + 2 = 8
    const prodAfter = await request(app).get(`/api/products/${productId}`);
    expect(prodAfter.body.data.stock_qty).toBe(8);

    // Deleting a sold product must archive it rather than breaking FK integrity
    const delRes = await request(app).delete(`/api/products/${productId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.archived).toBe(true);
  });

  it('exports valid backups, rejects corrupt backups, and atomically restores snapshots', async () => {
    await request(app).post('/api/products').send({
      name: 'Original Product',
      barcode: '111122223333',
      sku: 'ORIG-1',
      purchase_price_minor: 1000,
      selling_price_minor: 2000,
      stock_qty: 15,
    });

    const exportRes = await request(app).get('/api/backup/export');
    expect(exportRes.status).toBe(200);
    const backupSnapshot = exportRes.body.data;
    expect(backupSnapshot.data.products).toHaveLength(1);

    // Mutate state by adding another product
    await request(app).post('/api/products').send({
      name: 'Temporary Product',
      barcode: '999988887777',
      sku: 'TEMP-1',
      purchase_price_minor: 500,
      selling_price_minor: 1000,
      stock_qty: 3,
    });

    // Reject corrupt backup
    const badRestore = await request(app)
      .post('/api/backup/restore')
      .send({ invalid: true });
    expect(badRestore.status).toBe(400);

    // Restore original snapshot
    const restoreRes = await request(app).post('/api/backup/restore').send(backupSnapshot);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.data.restored_counts.products).toBe(1);

    const productsAfter = await request(app).get('/api/products');
    expect(productsAfter.body.data.total).toBe(1);
    expect(productsAfter.body.data.items[0].name).toBe('Original Product');
  });

  it('computes accurate financial reports distinguishing net sales, COGS, and gross profit', async () => {
    const prodRes = await request(app).post('/api/products').send({
      name: 'Cooking Oil 1L',
      barcode: '8961004010018',
      sku: 'GRN-2002',
      purchase_price_minor: 40000, // Cost 400
      selling_price_minor: 50000,  // Sell 500
      stock_qty: 20,
    });
    const productId = prodRes.body.data.id;

    await request(app).post('/api/sales').send({
      idempotency_key: 'report-sale-1',
      items: [{ product_id: productId, quantity: 2 }], // Gross 1000, Cost 800, Profit 200
      payment_method: 'cash',
      paid_minor: 100000,
    });

    const today = new Date().toISOString().slice(0, 10);
    const reportRes = await request(app).get(`/api/reports/summary?from=${today}&to=${today}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.financials.gross_sales_minor).toBe(100000);
    expect(reportRes.body.data.financials.net_sales_minor).toBe(100000);
    expect(reportRes.body.data.financials.cogs_minor).toBe(80000);
    expect(reportRes.body.data.financials.gross_profit_minor).toBe(20000);
  });
});
