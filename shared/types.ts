export type DiscountType = 'none' | 'fixed' | 'percentage';
export type PaymentMethod = 'cash' | 'card' | 'mobile_wallet' | 'other';
export type SaleStatus = 'completed' | 'partially_refunded' | 'refunded';
export type PaperWidth = '58mm' | '80mm' | 'a4';

export type InventoryMovementType =
  | 'initial'
  | 'sale'
  | 'restock'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'refund_restock'
  | 'backup_restore';

export interface CategoryDTO {
  id: number;
  name: string;
  description: string;
  color: string;
  is_active: number;
  product_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProductDTO {
  id: number;
  name: string;
  barcode: string;
  sku: string;
  category_id: number | null;
  category_name?: string | null;
  purchase_price_minor: number;
  selling_price_minor: number;
  stock_qty: number;
  min_stock_threshold: number;
  unit: string;
  description: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerDTO {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string;
  notes: string;
  is_active: number;
  total_spent_minor?: number;
  visit_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SaleItemDTO {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  sku: string;
  unit: string;
  quantity: number;
  unit_price_minor: number;
  purchase_price_minor: number;
  line_subtotal_minor: number;
  refunded_qty: number;
}

export interface PaymentDTO {
  id: number;
  sale_id: number;
  method: PaymentMethod;
  amount_minor: number;
  reference: string;
  created_at: string;
}

export interface RefundItemDTO {
  id: number;
  refund_id: number;
  sale_item_id: number;
  product_id: number;
  product_name?: string;
  quantity: number;
  unit_price_minor: number;
  refund_amount_minor: number;
}

export interface RefundDTO {
  id: number;
  refund_number: string;
  sale_id: number;
  reason: string;
  total_refund_minor: number;
  tax_refund_minor: number;
  refund_method: PaymentMethod;
  restock_items: number;
  processed_by: string;
  created_at: string;
  items?: RefundItemDTO[];
}

export interface SaleDTO {
  id: number;
  receipt_number: string;
  idempotency_key: string | null;
  customer_id: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashier_name: string;
  subtotal_minor: number;
  discount_type: DiscountType;
  discount_value: number;
  discount_amount_minor: number;
  tax_rate_bps: number;
  tax_amount_minor: number;
  total_minor: number;
  paid_minor: number;
  change_minor: number;
  payment_method: PaymentMethod;
  status: SaleStatus;
  notes: string;
  created_at: string;
  items?: SaleItemDTO[];
  payments?: PaymentDTO[];
  refunds?: RefundDTO[];
}

export interface InventoryMovementDTO {
  id: number;
  product_id: number;
  product_name?: string;
  product_barcode?: string;
  product_sku?: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  stock_before: number;
  stock_after: number;
  reference_type: string;
  reference_id: number | null;
  reason: string;
  performed_by: string;
  created_at: string;
}

export interface AppSettings {
  shop_name: string;
  shop_address: string;
  shop_phone: string;
  shop_tax_id: string;
  currency_code: string;
  currency_symbol: string;
  tax_rate_bps: number;
  tax_inclusive: boolean;
  tax_label: string;
  receipt_header: string;
  receipt_footer: string;
  receipt_paper_width: PaperWidth;
  default_payment_method: PaymentMethod;
  allow_negative_inventory: boolean;
  default_cashier_name: string;
}

export interface DashboardSummary {
  today: {
    sales_count: number;
    gross_sales_minor: number;
    discounts_minor: number;
    taxes_minor: number;
    refunds_minor: number;
    net_sales_minor: number;
    gross_profit_minor: number;
  };
  overall: {
    total_transactions: number;
    total_revenue_minor: number;
    active_products: number;
    total_stock_units: number;
    low_stock_count: number;
    out_of_stock_count: number;
    inventory_cost_value_minor: number;
    inventory_retail_value_minor: number;
  };
  weekly_summary: {
    sales_count: number;
    net_sales_minor: number;
    gross_profit_minor: number;
  };
  monthly_summary: {
    sales_count: number;
    net_sales_minor: number;
    gross_profit_minor: number;
  };
  daily_chart: Array<{
    date: string;
    sales_count: number;
    net_sales_minor: number;
    gross_profit_minor: number;
  }>;
  best_selling: Array<{
    product_id: number;
    product_name: string;
    sku: string;
    units_sold: number;
    revenue_minor: number;
  }>;
  low_stock_products: ProductDTO[];
  recent_transactions: SaleDTO[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}
