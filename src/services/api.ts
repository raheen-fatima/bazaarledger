import type {
  AppSettings,
  CategoryDTO,
  CustomerDTO,
  DashboardSummary,
  DiscountType,
  InventoryMovementDTO,
  PaymentMethod,
  ProductDTO,
  RefundDTO,
  SaleDTO,
} from '../../shared/types.ts';
import type { SalesReportResult } from '../../backend/src/modules/reports/reports.service.ts';
import type { BackupPayload } from '../../backend/src/modules/backup/backup.service.ts';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const json = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string; details?: unknown } }
    | null;

  if (!response.ok || !json || !json.success) {
    const errObj = json && !json.success ? json.error : null;
    throw new ApiClientError(
      errObj?.message ?? `Request failed (${response.status})`,
      response.status,
      errObj?.code ?? 'REQUEST_FAILED',
      errObj?.details
    );
  }

  return json.data;
}

export const api = {
  // Dashboard
  getDashboard: () => request<DashboardSummary>('/api/dashboard'),

  // Categories
  listCategories: (includeInactive = false) =>
    request<CategoryDTO[]>(`/api/categories?include_inactive=${includeInactive}`),
  createCategory: (body: { name: string; description?: string; color?: string; is_active?: boolean }) =>
    request<CategoryDTO>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id: number, body: { name?: string; description?: string; color?: string; is_active?: boolean }) =>
    request<CategoryDTO>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (id: number) =>
    request<{ archived: boolean; deleted: boolean }>(`/api/categories/${id}`, { method: 'DELETE' }),

  // Products
  listProducts: (params: {
    search?: string;
    category_id?: number;
    status?: string;
    sort_by?: string;
    sort_dir?: string;
    page?: number;
    page_size?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.category_id) qs.set('category_id', String(params.category_id));
    if (params.status) qs.set('status', params.status);
    if (params.sort_by) qs.set('sort_by', params.sort_by);
    if (params.sort_dir) qs.set('sort_dir', params.sort_dir);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    return request<{ items: ProductDTO[]; total: number; page: number; page_size: number }>(
      `/api/products?${qs.toString()}`
    );
  },
  lookupProductByCode: (code: string) =>
    request<ProductDTO | null>(`/api/products/lookup/${encodeURIComponent(code)}`),
  createProduct: (body: {
    name: string;
    barcode: string;
    sku: string;
    category_id: number | null;
    purchase_price_minor: number;
    selling_price_minor: number;
    stock_qty: number;
    min_stock_threshold: number;
    unit: string;
    description: string;
    is_active: boolean;
  }) => request<ProductDTO>('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (
    id: number,
    body: {
      name?: string;
      barcode?: string;
      sku?: string;
      category_id?: number | null;
      purchase_price_minor?: number;
      selling_price_minor?: number;
      min_stock_threshold?: number;
      unit?: string;
      description?: string;
      is_active?: boolean;
    }
  ) => request<ProductDTO>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteOrArchiveProduct: (id: number) =>
    request<{ archived: boolean; deleted: boolean }>(`/api/products/${id}`, { method: 'DELETE' }),

  // Inventory
  listMovements: (params: {
    product_id?: number;
    movement_type?: string;
    page?: number;
    page_size?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.product_id) qs.set('product_id', String(params.product_id));
    if (params.movement_type) qs.set('movement_type', params.movement_type);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    return request<{ items: InventoryMovementDTO[]; total: number; page: number; page_size: number }>(
      `/api/inventory/movements?${qs.toString()}`
    );
  },
  getLowStockProducts: () => request<ProductDTO[]>('/api/inventory/low-stock'),
  adjustStock: (body: {
    product_id: number;
    adjustment_type: 'add' | 'remove' | 'set';
    quantity: number;
    reason: string;
    authorized_by?: string;
    notes?: string;
    allow_negative_override?: boolean;
  }) =>
    request<{ product: ProductDTO; movement: InventoryMovementDTO }>('/api/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Customers
  listCustomers: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<CustomerDTO[]>(`/api/customers${qs}`);
  },
  getCustomerDetail: (id: number) =>
    request<{ customer: CustomerDTO; sales: SaleDTO[] }>(`/api/customers/${id}`),
  createCustomer: (body: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string;
    notes?: string;
  }) => request<CustomerDTO>('/api/customers', { method: 'POST', body: JSON.stringify(body) }),
  updateCustomer: (
    id: number,
    body: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      address?: string;
      notes?: string;
    }
  ) => request<CustomerDTO>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Sales
  listSales: (params: {
    search?: string;
    payment_method?: string;
    status?: string;
    customer_id?: number;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.payment_method) qs.set('payment_method', params.payment_method);
    if (params.status) qs.set('status', params.status);
    if (params.customer_id) qs.set('customer_id', String(params.customer_id));
    if (params.date_from) qs.set('date_from', params.date_from);
    if (params.date_to) qs.set('date_to', params.date_to);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    return request<{ items: SaleDTO[]; total: number; page: number; page_size: number }>(
      `/api/sales?${qs.toString()}`
    );
  },
  getSale: (id: number) => request<SaleDTO>(`/api/sales/${id}`),
  createSale: (body: {
    idempotency_key: string;
    customer_id: number | null;
    cashier_name?: string;
    items: Array<{ product_id: number; quantity: number }>;
    discount_type: DiscountType;
    discount_value: number;
    payment_method: PaymentMethod;
    paid_minor: number;
    payment_reference?: string;
    notes?: string;
  }) => request<SaleDTO>('/api/sales', { method: 'POST', body: JSON.stringify(body) }),
  processRefund: (
    saleId: number,
    body: {
      reason: string;
      refund_method: PaymentMethod;
      restock_items: boolean;
      processed_by?: string;
      items: Array<{ sale_item_id: number; quantity: number }>;
    }
  ) =>
    request<{ sale: SaleDTO; refund: RefundDTO }>(`/api/sales/${saleId}/refunds`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Reports
  getSalesReport: (from: string, to: string) =>
    request<SalesReportResult>(
      `/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),

  // Settings
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (body: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  // Backup
  exportBackup: () => request<BackupPayload>('/api/backup/export'),
  listSafetyBackups: () =>
    request<Array<{ filename: string; size_bytes: number; created_at: string }>>(
      '/api/backup/safety-list'
    ),
  restoreBackup: (payload: unknown) =>
    request<{ safety_backup_path: string | null; restored_counts: Record<string, number> }>(
      '/api/backup/restore',
      { method: 'POST', body: JSON.stringify(payload) }
    ),
};
