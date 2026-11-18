import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  BarcodeOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  MinusOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateSaleTotals } from '../../shared/money.ts';
import type { DiscountType, PaymentMethod, ProductDTO, SaleDTO } from '../../shared/types.ts';
import { ApiClientError, api } from '../services/api.ts';
import { usePosStore } from '../stores/posStore.ts';
import { formatCurrency, toMajorUnits, toMinorUnits } from '../utils/currency.ts';
import { ReceiptView } from '../components/ReceiptView.tsx';

export function PosPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [completedSale, setCompletedSale] = useState<SaleDTO | null>(null);
  const [heldDrawerOpen, setHeldDrawerOpen] = useState(false);

  const {
    items,
    customerId,
    discountType,
    discountInput,
    paymentMethod,
    paidMajorInput,
    paymentReference,
    notes,
    idempotencyKey,
    heldCarts,
    addItem,
    updateItemQty,
    removeItem,
    setCustomerId,
    setDiscount,
    setPaymentMethod,
    setPaidMajorInput,
    setPaymentReference,
    setNotes,
    holdCurrentCart,
    resumeHeldCart,
    deleteHeldCart,
    clearCart,
  } = usePosStore();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.listCategories(false),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.listCustomers(),
  });

  const { data: productsResult, isLoading: loadingProducts } = useQuery({
    queryKey: ['pos-products', searchTerm, selectedCategoryId],
    queryFn: () =>
      api.listProducts({
        search: searchTerm || undefined,
        category_id: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
        status: 'active',
        page: 1,
        page_size: 100,
      }),
  });

  const products = productsResult?.items ?? [];

  // Initialize default payment method from settings when cart is fresh
  useEffect(() => {
    if (settings?.default_payment_method && items.length === 0) {
      setPaymentMethod(settings.default_payment_method);
    }
  }, [settings?.default_payment_method]);

  // Compute live cart preview (authoritative final calculation happens on backend)
  const discountValue = useMemo(() => {
    if (discountType === 'fixed') return toMinorUnits(discountInput || 0);
    if (discountType === 'percentage') return Math.round((discountInput || 0) * 100);
    return 0;
  }, [discountType, discountInput]);

  const totals = useMemo(() => {
    return calculateSaleTotals({
      items: items.map((i) => ({
        unitPriceMinor: i.unit_price_minor,
        quantity: i.quantity,
      })),
      discountType,
      discountValue,
      taxRateBps: settings?.tax_rate_bps ?? 0,
      taxInclusive: settings?.tax_inclusive ?? false,
    });
  }, [items, discountType, discountValue, settings]);

  const grandTotalMajor = toMajorUnits(totals.totalMinor);
  const effectivePaidMinor =
    paidMajorInput !== null ? toMinorUnits(paidMajorInput) : totals.totalMinor;
  const changeMinor = Math.max(0, effectivePaidMinor - totals.totalMinor);
  const isPaymentSufficient = effectivePaidMinor >= totals.totalMinor;

  const checkoutMutation = useMutation({
    mutationFn: api.createSale,
    onSuccess: (sale) => {
      messageApi.success(`Sale ${sale.receipt_number} completed`);
      setCompletedSale(sale);
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        messageApi.error(err.message);
      } else {
        messageApi.error('Failed to complete sale');
      }
    },
  });

  const handleAddProduct = (product: ProductDTO) => {
    const existing = items.find((i) => i.product_id === product.id);
    const nextQty = (existing?.quantity ?? 0) + 1;
    if (!settings?.allow_negative_inventory && nextQty > product.stock_qty) {
      messageApi.warning(
        `Insufficient stock for "${product.name}". Available: ${product.stock_qty} ${product.unit}`
      );
      return;
    }
    addItem(product, 1);
  };

  // Manual barcode / SKU enter key scanner support
  const handleBarcodeEnter = async () => {
    const code = searchTerm.trim();
    if (!code) return;

    try {
      const exactMatch = await api.lookupProductByCode(code);
      if (exactMatch) {
        handleAddProduct(exactMatch);
        setSearchTerm('');
        return;
      }
    } catch {
      // fall through to filtered list
    }

    if (products.length === 1) {
      handleAddProduct(products[0]);
      setSearchTerm('');
    } else if (products.length === 0) {
      messageApi.warning(`No active product found matching "${code}"`);
    }
  };

  const handleCompleteSale = () => {
    if (items.length === 0) {
      messageApi.warning('Add products to the cart first');
      return;
    }
    if (!isPaymentSufficient) {
      messageApi.error('Amount received cannot be less than grand total');
      return;
    }

    checkoutMutation.mutate({
      idempotency_key: idempotencyKey,
      customer_id: customerId,
      cashier_name: settings?.default_cashier_name || 'Counter 1',
      items: items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      })),
      discount_type: discountType,
      discount_value: discountValue,
      payment_method: paymentMethod,
      paid_minor: effectivePaidMinor,
      payment_reference: paymentReference,
      notes,
    });
  };

  // F9 shortcut to complete sale
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F9' && items.length > 0 && !checkoutMutation.isPending) {
        e.preventDefault();
        handleCompleteSale();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {contextHolder}

      {/* Left Pane: Search, Barcode Entry, and Product Catalog */}
      <div className="w-full lg:flex-1 space-y-3 min-w-0">
        <Card className="border-slate-200 shadow-none" size="small">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              ref={(el) => {
                searchInputRef.current = el?.input ?? null;
              }}
              size="large"
              autoFocus
              allowClear
              prefix={<BarcodeOutlined className="text-slate-400" />}
              suffix={<SearchOutlined className="text-slate-400" />}
              placeholder="Scan barcode, enter SKU, or search product name (Press Enter to add exact match)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onPressEnter={handleBarcodeEnter}
            />
            {heldCarts.length > 0 && (
              <Badge count={heldCarts.length} size="small">
                <Button
                  size="large"
                  icon={<PauseCircleOutlined />}
                  onClick={() => setHeldDrawerOpen(true)}
                >
                  Held Orders
                </Button>
              </Badge>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button
              size="small"
              type={selectedCategoryId === 'all' ? 'primary' : 'default'}
              onClick={() => setSelectedCategoryId('all')}
            >
              All Items
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                size="small"
                type={selectedCategoryId === cat.id ? 'primary' : 'default'}
                onClick={() => setSelectedCategoryId(cat.id)}
              >
                {cat.name}
              </Button>
            ))}
          </div>
        </Card>

        <Card className="border-slate-200 shadow-none" size="small">
          {loadingProducts ? (
            <div className="py-12 text-center text-slate-500">Loading catalog...</div>
          ) : products.length === 0 ? (
            <Empty
              description="No matching active products found"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[calc(100vh-270px)] overflow-y-auto pr-1">
              {products.map((product) => {
                const outOfStock =
                  !settings?.allow_negative_inventory && product.stock_qty <= 0;
                const lowStock =
                  product.stock_qty > 0 && product.stock_qty <= product.min_stock_threshold;
                const inCart = items.find((i) => i.product_id === product.id);

                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => handleAddProduct(product)}
                    className={`group flex flex-col justify-between rounded-lg border p-3 text-left transition-colors ${
                      outOfStock
                        ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                        : inCart
                          ? 'cursor-pointer border-blue-600 bg-blue-50/40 hover:bg-blue-50'
                          : 'cursor-pointer border-slate-200 bg-white hover:border-blue-500 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm text-slate-900 leading-snug line-clamp-2">
                          {product.name}
                        </span>
                        {inCart && (
                          <Tag color="blue" className="m-0 shrink-0 tabular-nums">
                            {inCart.quantity}
                          </Tag>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
                        {product.sku} · {product.barcode}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100">
                      <span className="font-semibold text-sm text-slate-900 tabular-nums">
                        {formatCurrency(product.selling_price_minor, settings)}
                      </span>
                      <span
                        className={`text-xs tabular-nums ${
                          outOfStock
                            ? 'font-semibold text-red-600'
                            : lowStock
                              ? 'font-medium text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {outOfStock
                          ? 'Out of stock'
                          : `${product.stock_qty} ${product.unit}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Right Pane: Active Bill & Checkout */}
      <div className="w-full lg:w-[430px] shrink-0">
        <Card
          className="border-slate-200 shadow-none"
          size="small"
          title={
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <ShoppingCartOutlined />
                Current Bill ({totals.totalQuantity} items)
              </span>
              <Space size="small">
                {items.length > 0 && (
                  <>
                    <Button
                      size="small"
                      icon={<PauseCircleOutlined />}
                      onClick={() => {
                        holdCurrentCart();
                        messageApi.info('Order placed on hold');
                      }}
                    >
                      Hold
                    </Button>
                    <Popconfirm
                      title="Cancel & clear current cart?"
                      onConfirm={clearCart}
                      okText="Clear"
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        Clear
                      </Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            </div>
          }
        >
          {/* Customer Selection */}
          <div className="mb-3">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              className="w-full"
              placeholder="Walk-in Customer (Optional)"
              value={customerId ?? undefined}
              onChange={(val) => setCustomerId(val ?? null)}
              options={customers.map((c) => ({
                value: c.id,
                label: `${c.name}${c.phone ? ` (${c.phone})` : ''}`,
              }))}
            />
          </div>

          {/* Cart Items */}
          <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-100 border-y border-slate-200">
            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                Scan a barcode or click any product to start billing
              </div>
            ) : (
              items.map((item) => (
                <div key={item.product_id} className="py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {item.name}
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      {formatCurrency(item.unit_price_minor, settings)} / {item.unit}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="small"
                      icon={<MinusOutlined />}
                      onClick={() => updateItemQty(item.product_id, item.quantity - 1)}
                      aria-label={`Decrease quantity for ${item.name}`}
                    />
                    <InputNumber
                      size="small"
                      min={1}
                      max={settings?.allow_negative_inventory ? 99999 : item.stock_qty}
                      value={item.quantity}
                      onChange={(val) => {
                        if (typeof val === 'number') {
                          updateItemQty(item.product_id, val);
                        }
                      }}
                      className="w-14! text-center tabular-nums"
                    />
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        if (
                          !settings?.allow_negative_inventory &&
                          item.quantity + 1 > item.stock_qty
                        ) {
                          messageApi.warning(
                            `Max available stock reached (${item.stock_qty})`
                          );
                          return;
                        }
                        updateItemQty(item.product_id, item.quantity + 1);
                      }}
                      aria-label={`Increase quantity for ${item.name}`}
                    />
                  </div>

                  <div className="w-20 text-right font-semibold text-sm text-slate-900 tabular-nums shrink-0">
                    {formatCurrency(item.unit_price_minor * item.quantity, settings)}
                  </div>

                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeItem(item.product_id)}
                    aria-label={`Remove ${item.name}`}
                  />
                </div>
              ))
            )}
          </div>

          {/* Discount Controls */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 shrink-0">Discount:</span>
            <div className="flex items-center gap-1.5">
              <Segmented
                size="small"
                value={discountType}
                onChange={(val) => setDiscount(val as DiscountType, 0)}
                options={[
                  { label: 'None', value: 'none' },
                  { label: settings?.currency_symbol ?? 'Fixed', value: 'fixed' },
                  { label: '%', value: 'percentage' },
                ]}
              />
              {discountType !== 'none' && (
                <InputNumber
                  size="small"
                  min={0}
                  max={discountType === 'percentage' ? 100 : toMajorUnits(totals.subtotalMinor)}
                  step={discountType === 'percentage' ? 1 : 10}
                  value={discountInput}
                  onChange={(v) => setDiscount(discountType, typeof v === 'number' ? v : 0)}
                  className="w-24! tabular-nums"
                />
              )}
            </div>
          </div>

          {/* Totals Summary */}
          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="tabular-nums">
                {formatCurrency(totals.subtotalMinor, settings)}
              </span>
            </div>
            {totals.discountAmountMinor > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount</span>
                <span className="tabular-nums">
                  -{formatCurrency(totals.discountAmountMinor, settings)}
                </span>
              </div>
            )}
            {(settings?.tax_rate_bps ?? 0) > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>
                  {settings?.tax_label ?? 'Tax'} (
                  {((settings?.tax_rate_bps ?? 0) / 100).toFixed(2)}%
                  {settings?.tax_inclusive ? ' incl.' : ''})
                </span>
                <span className="tabular-nums">
                  {formatCurrency(totals.taxAmountMinor, settings)}
                </span>
              </div>
            )}
            <Divider className="my-1.5!" />
            <div className="flex justify-between items-baseline">
              <span className="font-semibold text-slate-900">Grand Total</span>
              <span className="text-xl font-bold text-slate-900 tabular-nums">
                {formatCurrency(totals.totalMinor, settings)}
              </span>
            </div>
          </div>

          {/* Payment Method & Tendered */}
          <div className="mt-3 space-y-2.5">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Payment Method</div>
              <Segmented
                block
                value={paymentMethod}
                onChange={(val) => setPaymentMethod(val as PaymentMethod)}
                options={[
                  { label: 'Cash', value: 'cash' },
                  { label: 'Card', value: 'card' },
                  { label: 'Wallet', value: 'mobile_wallet' },
                  { label: 'Other', value: 'other' },
                ]}
              />
            </div>

            {paymentMethod === 'cash' ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Cash Received</span>
                  <InputNumber
                    className="w-40! tabular-nums"
                    min={0}
                    step={50}
                    placeholder={grandTotalMajor.toFixed(2)}
                    value={paidMajorInput}
                    onChange={(val) => setPaidMajorInput(typeof val === 'number' ? val : null)}
                  />
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                  <Button size="small" onClick={() => setPaidMajorInput(grandTotalMajor)}>
                    Exact
                  </Button>
                  {[100, 500, 1000, 5000].map((amt) => (
                    <Button
                      key={amt}
                      size="small"
                      onClick={() => setPaidMajorInput(amt)}
                      className="tabular-nums"
                    >
                      {amt}
                    </Button>
                  ))}
                </div>
                <div className="flex justify-between rounded-md bg-blue-50 px-3 py-1.5 text-sm">
                  <span className="font-medium text-blue-900">Change to Return</span>
                  <span className="font-bold text-blue-900 tabular-nums">
                    {formatCurrency(changeMinor, settings)}
                  </span>
                </div>
              </div>
            ) : (
              <Input
                placeholder="Transaction / Card Reference (optional)"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            )}

            <Input
              placeholder="Order notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {!isPaymentSufficient && items.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`Received amount is short by ${formatCurrency(
                  totals.totalMinor - effectivePaidMinor,
                  settings
                )}`}
              />
            )}

            <Button
              type="primary"
              size="large"
              block
              icon={<CheckCircleOutlined />}
              disabled={items.length === 0 || !isPaymentSufficient}
              loading={checkoutMutation.isPending}
              onClick={handleCompleteSale}
            >
              Complete Sale (F9) — {formatCurrency(totals.totalMinor, settings)}
            </Button>
          </div>
        </Card>
      </div>

      {/* Receipt Preview Modal after Checkout */}
      <Modal
        open={Boolean(completedSale)}
        onCancel={() => {
          setCompletedSale(null);
          setTimeout(() => searchInputRef.current?.focus(), 100);
        }}
        footer={[
          <Button
            key="close"
            type="primary"
            onClick={() => {
              setCompletedSale(null);
              setTimeout(() => searchInputRef.current?.focus(), 100);
            }}
          >
            New Sale
          </Button>,
        ]}
        title={`Sale Completed — ${completedSale?.receipt_number ?? ''}`}
        width={680}
        destroyOnHidden
      >
        {completedSale && settings && (
          <ReceiptView sale={completedSale} settings={settings} />
        )}
      </Modal>

      {/* Held Carts Drawer */}
      <Drawer
        title="Held / Parked Orders"
        open={heldDrawerOpen}
        onClose={() => setHeldDrawerOpen(false)}
        width={380}
      >
        {heldCarts.length === 0 ? (
          <Empty description="No held orders" />
        ) : (
          <div className="space-y-3">
            {heldCarts.map((held) => (
              <Card key={held.id} size="small" className="border-slate-200">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{held.label}</div>
                    <div className="text-xs text-slate-500">Held at {held.createdAt}</div>
                  </div>
                  <Space size="small">
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        resumeHeldCart(held.id);
                        setHeldDrawerOpen(false);
                      }}
                    >
                      Resume
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => deleteHeldCart(held.id)}
                    >
                      Drop
                    </Button>
                  </Space>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
