import type Database from 'better-sqlite3';

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#1d4ed8',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        barcode TEXT NOT NULL UNIQUE,
        sku TEXT NOT NULL UNIQUE,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        purchase_price_minor INTEGER NOT NULL CHECK (purchase_price_minor >= 0),
        selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor >= 0),
        stock_qty INTEGER NOT NULL DEFAULT 0,
        min_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (min_stock_threshold >= 0),
        unit TEXT NOT NULL DEFAULT 'pcs',
        description TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        email TEXT,
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT NOT NULL UNIQUE,
        idempotency_key TEXT UNIQUE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        cashier_name TEXT NOT NULL DEFAULT 'Cashier',
        subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
        discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'fixed', 'percentage')),
        discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
        discount_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_minor >= 0),
        tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps >= 0),
        tax_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
        total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
        paid_minor INTEGER NOT NULL CHECK (paid_minor >= 0),
        change_minor INTEGER NOT NULL DEFAULT 0 CHECK (change_minor >= 0),
        payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'mobile_wallet', 'other')),
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partially_refunded', 'refunded')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales(receipt_number);
      CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
      CREATE INDEX IF NOT EXISTS idx_sales_method ON sales(payment_method);
      CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL,
        barcode TEXT NOT NULL,
        sku TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'pcs',
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        purchase_price_minor INTEGER NOT NULL CHECK (purchase_price_minor >= 0),
        line_subtotal_minor INTEGER NOT NULL CHECK (line_subtotal_minor >= 0),
        refunded_qty INTEGER NOT NULL DEFAULT 0 CHECK (refunded_qty >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'mobile_wallet', 'other')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
        reference TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

      CREATE TABLE IF NOT EXISTS inventory_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK (
          movement_type IN ('initial', 'sale', 'restock', 'adjustment_in', 'adjustment_out', 'refund_restock', 'backup_restore')
        ),
        quantity_delta INTEGER NOT NULL,
        stock_before INTEGER NOT NULL,
        stock_after INTEGER NOT NULL,
        reference_type TEXT NOT NULL DEFAULT 'adjustment',
        reference_id INTEGER,
        reason TEXT NOT NULL DEFAULT '',
        performed_by TEXT NOT NULL DEFAULT 'System',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id);
      CREATE INDEX IF NOT EXISTS idx_inv_mov_created ON inventory_movements(created_at);
      CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON inventory_movements(movement_type);

      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('add', 'remove', 'set')),
        quantity_delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        authorized_by TEXT NOT NULL DEFAULT 'Store Manager',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_stock_adj_product ON stock_adjustments(product_id);

      CREATE TABLE IF NOT EXISTS refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        refund_number TEXT NOT NULL UNIQUE,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        reason TEXT NOT NULL,
        total_refund_minor INTEGER NOT NULL CHECK (total_refund_minor >= 0),
        tax_refund_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_refund_minor >= 0),
        refund_method TEXT NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash', 'card', 'mobile_wallet', 'other')),
        restock_items INTEGER NOT NULL DEFAULT 1 CHECK (restock_items IN (0, 1)),
        processed_by TEXT NOT NULL DEFAULT 'Store Manager',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_refunds_sale ON refunds(sale_id);

      CREATE TABLE IF NOT EXISTS refund_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        refund_id INTEGER NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
        sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        refund_amount_minor INTEGER NOT NULL CHECK (refund_amount_minor >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON refund_items(refund_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details_json TEXT NOT NULL DEFAULT '{}',
        actor TEXT NOT NULL DEFAULT 'System',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    `,
  },
];

export const DEFAULT_SETTINGS_ENTRIES: Record<string, string> = {
  shop_name: 'Al-Madina Fresh Supermarket',
  shop_address: 'Plot 14, Main Boulevard, Gulberg III, Lahore',
  shop_phone: '+92 42 35761920',
  shop_tax_id: 'NTN-4189204-7',
  currency_code: 'PKR',
  currency_symbol: 'Rs.',
  tax_rate_bps: '0',
  tax_inclusive: 'false',
  tax_label: 'GST',
  receipt_header: 'Quality Groceries & Everyday Essentials',
  receipt_footer: 'Thank you for shopping with us! Exchange within 7 days with original receipt.',
  receipt_paper_width: '80mm',
  default_payment_method: 'cash',
  allow_negative_inventory: 'false',
  default_cashier_name: 'Counter 1',
};

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const getApplied = db.prepare('SELECT id FROM migrations WHERE id = ?');
  const insertMigration = db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)');

  const applyAll = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      const existing = getApplied.get(migration.id);
      if (!existing) {
        db.exec(migration.sql);
        insertMigration.run(migration.id, migration.name);
      }
    }

    const insertSetting = db.prepare(
      `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
    );
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS_ENTRIES)) {
      insertSetting.run(key, value);
    }
  });

  applyAll();
}

export function seedInitialCatalogIfEmpty(db: Database.Database): void {
  const catCountRow = db.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number };
  const prodCountRow = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number };

  if (catCountRow.cnt > 0 || prodCountRow.cnt > 0) {
    return;
  }

  const seed = db.transaction(() => {
    const insertCat = db.prepare(
      `INSERT INTO categories (name, description, color) VALUES (?, ?, ?)`
    );
    const categories = [
      ['Dairy & Eggs', 'Fresh milk, yogurt, butter, cheese, and farm eggs', '#2563eb'],
      ['Grains & Staples', 'Basmati rice, wheat flour, lentils, cooking oil, and sugar', '#d97706'],
      ['Beverages', 'Tea, coffee, juices, mineral water, and soft drinks', '#0891b2'],
      ['Bakery & Breakfast', 'Bread, rusks, biscuits, honey, and cereals', '#b45309'],
      ['Snacks & Confectionery', 'Chips, chocolates, nuts, and instant noodles', '#7c3aed'],
      ['Household & Cleaning', 'Detergents, dishwash liquid, tissue papers, and cleaners', '#059669'],
      ['Personal Care', 'Soaps, shampoos, toothpaste, and skincare', '#db2777'],
    ];

    const categoryIds: Record<string, number> = {};
    for (const [name, description, color] of categories) {
      const info = insertCat.run(name, description, color);
      categoryIds[name] = Number(info.lastInsertRowid);
    }

    const insertProd = db.prepare(`
      INSERT INTO products (
        name, barcode, sku, category_id, purchase_price_minor, selling_price_minor,
        stock_qty, min_stock_threshold, unit, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMov = db.prepare(`
      INSERT INTO inventory_movements (
        product_id, movement_type, quantity_delta, stock_before, stock_after,
        reference_type, reference_id, reason, performed_by
      ) VALUES (?, 'initial', ?, 0, ?, 'product', ?, 'Initial store stock setup', 'System')
    `);

    const products = [
      ['Olpers Full Cream Milk 1L', '8961003021015', 'DAI-1001', 'Dairy & Eggs', 26500, 29500, 64, 15, 'L', 'UHT treated full cream dairy milk 1 liter pack'],
      ['Nurpur Unsalted Butter 200g', '8961008112046', 'DAI-1002', 'Dairy & Eggs', 41000, 46000, 22, 8, 'pack', 'Pure dairy butter 200g foil wrap'],
      ['Farm Fresh Eggs (Dozen)', '8961001000120', 'DAI-1003', 'Dairy & Eggs', 31000, 35000, 18, 10, 'dozen', 'Grade A brown & white farm eggs 12 pcs'],
      ['Guard Super Kernel Basmati Rice 5kg', '8964000125001', 'GRN-2001', 'Grains & Staples', 165000, 189000, 35, 8, 'pack', 'Aged extra-long grain super basmati rice 5kg bag'],
      ['Dalda Cooking Oil 1L Pouch', '8961004010018', 'GRN-2002', 'Grains & Staples', 49000, 53500, 48, 12, 'L', 'Vitamin A & D fortified vegetable cooking oil'],
      ['National Iodized Pink Salt 800g', '8961007011029', 'GRN-2003', 'Grains & Staples', 5500, 7500, 70, 15, 'pack', 'Refined iodized table salt'],
      ['Tapal Danedar Tea 450g', '8961002014502', 'BEV-3001', 'Beverages', 68000, 76000, 40, 10, 'pack', 'Rich Kenyan blend black tea 450g pouch'],
      ['Nestle Pure Life Water 1.5L', '8961005011509', 'BEV-3002', 'Beverages', 7800, 10000, 120, 24, 'pcs', 'Purified mineral drinking water 1.5L bottle'],
      ['Shezan Mango Juice 1L', '8961006011004', 'BEV-3003', 'Beverages', 19500, 23000, 28, 10, 'L', 'Natural mango nectar tetra pak'],
      ['Dawn Milky Bread Large', '8964002100011', 'BAK-4001', 'Bakery & Breakfast', 14500, 17500, 4, 8, 'pcs', 'Freshly baked soft white sandwich loaf'],
      ['LU Candi Biscuits Half Roll', '8961009022014', 'BAK-4002', 'Bakery & Breakfast', 4200, 5000, 85, 20, 'pack', 'Caramelized brown sugar crunch biscuits'],
      ['Lays Classic Salted Chips 65g', '8961010033018', 'SNK-5001', 'Snacks & Confectionery', 7500, 9500, 52, 15, 'pack', 'Crispy potato chips classic salted'],
      ['Knorr Chattpatta Noodles Pack', '8961001144012', 'SNK-5002', 'Snacks & Confectionery', 4800, 6000, 90, 20, 'pack', 'Instant spicy masala noodles 66g'],
      ['Surf Excel Washing Powder 1kg', '8961001255019', 'HOU-6001', 'Household & Cleaning', 47500, 54000, 30, 8, 'pack', 'Stain removal laundry detergent 1kg'],
      ['Lemon Max Dishwash Liquid 475ml', '8961001366016', 'HOU-6002', 'Household & Cleaning', 21000, 25500, 3, 6, 'pcs', 'Concentrated lemon grease-cutting dish liquid'],
      ['Dettol Original Soap 115g', '8961001477013', 'PER-7001', 'Personal Care', 12000, 14500, 45, 12, 'pcs', 'Antibacterial protection bath soap'],
    ];

    for (const [name, barcode, sku, catName, cost, price, qty, minThreshold, unit, desc] of products) {
      const catId = categoryIds[catName as string];
      const info = insertProd.run(name, barcode, sku, catId, cost, price, qty, minThreshold, unit, desc);
      const prodId = Number(info.lastInsertRowid);
      insertMov.run(prodId, qty, qty, prodId);
    }

    const insertCustomer = db.prepare(
      `INSERT INTO customers (name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?)`
    );
    insertCustomer.run('Muhammad Tariq', '0300-4128901', 'tariq.m@example.local', 'House 22-B, Model Town, Lahore', 'Regular household account');
    insertCustomer.run('Ayesha Siddiqui', '0321-8845120', 'ayesha.s@example.local', 'Street 7, Cavalry Ground, Lahore', 'Prefers WhatsApp receipt note');
  });

  seed();
}
