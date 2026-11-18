import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(80),
  description: z.string().trim().max(300).optional().default(''),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional().default('#1d4ed8'),
  is_active: z.boolean().optional().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(150),
  barcode: z.string().trim().min(1, 'Barcode is required').max(64),
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  category_id: z.number().int().positive().nullable().optional().default(null),
  purchase_price_minor: z.number().int().min(0, 'Purchase price must be >= 0'),
  selling_price_minor: z.number().int().min(0, 'Selling price must be >= 0'),
  stock_qty: z.number().int().min(0, 'Initial stock must be >= 0').optional().default(0),
  min_stock_threshold: z.number().int().min(0).optional().default(5),
  unit: z.string().trim().min(1).max(20).optional().default('pcs'),
  description: z.string().trim().max(500).optional().default(''),
  is_active: z.boolean().optional().default(true),
});

export const updateProductSchema = createProductSchema
  .omit({ stock_qty: true })
  .partial();

export const stockAdjustmentSchema = z.object({
  product_id: z.number().int().positive(),
  adjustment_type: z.enum(['add', 'remove', 'set']),
  quantity: z.number().int().min(0, 'Quantity must be non-negative'),
  reason: z.string().trim().min(2, 'Adjustment reason is required').max(250),
  authorized_by: z.string().trim().min(1).max(80).optional().default('Store Manager'),
  notes: z.string().trim().max(300).optional().default(''),
  allow_negative_override: z.boolean().optional().default(false),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  phone: z.string().trim().max(40).nullable().optional().default(null),
  email: z.string().trim().email('Invalid email').or(z.literal('')).nullable().optional().default(null),
  address: z.string().trim().max(300).optional().default(''),
  notes: z.string().trim().max(300).optional().default(''),
  is_active: z.boolean().optional().default(true),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const createSaleSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(120).optional(),
  customer_id: z.number().int().positive().nullable().optional().default(null),
  cashier_name: z.string().trim().min(1).max(80).optional(),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().min(1, 'Quantity must be at least 1').max(100000),
      })
    )
    .min(1, 'Cart must contain at least one item'),
  discount_type: z.enum(['none', 'fixed', 'percentage']).optional().default('none'),
  discount_value: z.number().int().min(0).optional().default(0),
  payment_method: z.enum(['cash', 'card', 'mobile_wallet', 'other']).optional().default('cash'),
  paid_minor: z.number().int().min(0),
  payment_reference: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(300).optional().default(''),
});

export const createRefundSchema = z.object({
  reason: z.string().trim().min(2, 'Refund reason is required').max(300),
  refund_method: z.enum(['cash', 'card', 'mobile_wallet', 'other']).optional().default('cash'),
  restock_items: z.boolean().optional().default(true),
  processed_by: z.string().trim().min(1).max(80).optional().default('Store Manager'),
  items: z
    .array(
      z.object({
        sale_item_id: z.number().int().positive(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1, 'Select at least one item to refund'),
});

export const updateSettingsSchema = z.object({
  shop_name: z.string().trim().min(1).max(120).optional(),
  shop_address: z.string().trim().max(250).optional(),
  shop_phone: z.string().trim().max(60).optional(),
  shop_tax_id: z.string().trim().max(60).optional(),
  currency_code: z.string().trim().min(1).max(10).optional(),
  currency_symbol: z.string().trim().min(1).max(10).optional(),
  tax_rate_bps: z.number().int().min(0).max(5000).optional(),
  tax_inclusive: z.boolean().optional(),
  tax_label: z.string().trim().min(1).max(30).optional(),
  receipt_header: z.string().trim().max(200).optional(),
  receipt_footer: z.string().trim().max(300).optional(),
  receipt_paper_width: z.enum(['58mm', '80mm', 'a4']).optional(),
  default_payment_method: z.enum(['cash', 'card', 'mobile_wallet', 'other']).optional(),
  allow_negative_inventory: z.boolean().optional(),
  default_cashier_name: z.string().trim().min(1).max(80).optional(),
});
