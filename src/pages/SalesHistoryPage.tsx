import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import {
  PrinterOutlined,
  RollbackOutlined,
  SearchOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type dayjs from 'dayjs';
import type { PaymentMethod, SaleDTO } from '../../shared/types.ts';
import { ApiClientError, api } from '../services/api.ts';
import { formatCurrency, formatDateTime } from '../utils/currency.ts';
import { ReceiptView } from '../components/ReceiptView.tsx';

export function SalesHistoryPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(
    null
  );
  const [page, setPage] = useState(1);

  const [detailSale, setDetailSale] = useState<SaleDTO | null>(null);
  const [receiptSale, setReceiptSale] = useState<SaleDTO | null>(null);
  const [refundTargetSale, setRefundTargetSale] = useState<SaleDTO | null>(null);
  const [refundQuantities, setRefundQuantities] = useState<Record<number, number>>({});
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [restockItems, setRestockItems] = useState(true);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.listCustomers(),
  });

  const dateFrom = dateRange?.[0]?.format('YYYY-MM-DD');
  const dateTo = dateRange?.[1]?.format('YYYY-MM-DD');

  const { data: salesData, isLoading } = useQuery({
    queryKey: ['sales', search, paymentMethod, statusFilter, customerId, dateFrom, dateTo, page],
    queryFn: () =>
      api.listSales({
        search: search || undefined,
        payment_method: paymentMethod,
        status: statusFilter,
        customer_id: customerId,
        date_from: dateFrom,
        date_to: dateTo,
        page,
        page_size: 20,
      }),
  });

  const refundMutation = useMutation({
    mutationFn: (payload: {
      saleId: number;
      reason: string;
      refund_method: PaymentMethod;
      restock_items: boolean;
      items: Array<{ sale_item_id: number; quantity: number }>;
    }) =>
      api.processRefund(payload.saleId, {
        reason: payload.reason,
        refund_method: payload.refund_method,
        restock_items: payload.restock_items,
        items: payload.items,
      }),
    onSuccess: (res) => {
      messageApi.success(`Refund ${res.refund.refund_number} processed`);
      setRefundTargetSale(null);
      setDetailSale(res.sale);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      messageApi.error(err instanceof ApiClientError ? err.message : 'Refund failed');
    },
  });

  const loadFullSale = async (id: number, target: 'detail' | 'receipt' | 'refund') => {
    const full = await api.getSale(id);
    if (target === 'detail') setDetailSale(full);
    if (target === 'receipt') setReceiptSale(full);
    if (target === 'refund') {
      const initialQty: Record<number, number> = {};
      for (const item of full.items ?? []) {
        const remaining = item.quantity - item.refunded_qty;
        if (remaining > 0) initialQty[item.id] = 0;
      }
      setRefundQuantities(initialQty);
      setRefundReason('');
      setRefundMethod(full.payment_method);
      setRestockItems(true);
      setRefundTargetSale(full);
    }
  };

  const handleSubmitRefund = () => {
    if (!refundTargetSale) return;
    if (!refundReason.trim() || refundReason.trim().length < 2) {
      messageApi.warning('Please enter a refund reason');
      return;
    }
    const selectedItems = Object.entries(refundQuantities)
      .filter(([, qty]) => qty > 0)
      .map(([saleItemId, quantity]) => ({
        sale_item_id: Number(saleItemId),
        quantity,
      }));

    if (selectedItems.length === 0) {
      messageApi.warning('Select at least one item quantity to refund');
      return;
    }

    refundMutation.mutate({
      saleId: refundTargetSale.id,
      reason: refundReason.trim(),
      refund_method: refundMethod,
      restock_items: restockItems,
      items: selectedItems,
    });
  };

  return (
    <div className="space-y-4">
      {contextHolder}

      <Card className="border-slate-200 shadow-none" size="small">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="Receipt #, customer name or phone..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-64!"
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(vals) => {
              setDateRange(vals);
              setPage(1);
            }}
          />
          <Select
            value={paymentMethod}
            onChange={(v) => {
              setPaymentMethod(v);
              setPage(1);
            }}
            className="w-36!"
            options={[
              { label: 'All Methods', value: 'all' },
              { label: 'Cash', value: 'cash' },
              { label: 'Card', value: 'card' },
              { label: 'Mobile Wallet', value: 'mobile_wallet' },
              { label: 'Other', value: 'other' },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            className="w-40!"
            options={[
              { label: 'All Statuses', value: 'all' },
              { label: 'Completed', value: 'completed' },
              { label: 'Partially Refunded', value: 'partially_refunded' },
              { label: 'Refunded', value: 'refunded' },
            ]}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Filter by customer"
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setPage(1);
            }}
            className="w-48!"
            options={customers.map((c) => ({ label: c.name, value: c.id }))}
          />
        </div>
      </Card>

      <Card className="border-slate-200 shadow-none" size="small">
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={salesData?.items ?? []}
          scroll={{ x: 920 }}
          pagination={{
            current: page,
            pageSize: 20,
            total: salesData?.total ?? 0,
            onChange: setPage,
          }}
          columns={[
            {
              title: 'Receipt #',
              dataIndex: 'receipt_number',
              render: (v: string) => (
                <span className="font-mono-tabular font-semibold text-slate-900">{v}</span>
              ),
            },
            {
              title: 'Date & Time',
              dataIndex: 'created_at',
              render: (v: string) => <span className="text-xs">{formatDateTime(v)}</span>,
            },
            {
              title: 'Customer',
              dataIndex: 'customer_name',
              render: (v: string | null) => v || 'Walk-in',
            },
            {
              title: 'Method',
              dataIndex: 'payment_method',
              render: (v: string) => <span className="capitalize">{v.replace('_', ' ')}</span>,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => (
                <Tag color={s === 'completed' ? 'green' : s === 'refunded' ? 'red' : 'orange'}>
                  {s.replace('_', ' ')}
                </Tag>
              ),
            },
            {
              title: 'Discount',
              dataIndex: 'discount_amount_minor',
              align: 'right',
              render: (v: number) => (
                <span className="tabular-nums text-slate-600">
                  {v > 0 ? `-${formatCurrency(v, settings)}` : '—'}
                </span>
              ),
            },
            {
              title: 'Total',
              dataIndex: 'total_minor',
              align: 'right',
              render: (v: number) => (
                <span className="font-semibold tabular-nums">
                  {formatCurrency(v, settings)}
                </span>
              ),
            },
            {
              title: 'Actions',
              key: 'actions',
              align: 'right',
              render: (_: unknown, r: SaleDTO) => (
                <Space size="small">
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => loadFullSale(r.id, 'detail')}
                  >
                    Details
                  </Button>
                  <Button
                    size="small"
                    icon={<PrinterOutlined />}
                    onClick={() => loadFullSale(r.id, 'receipt')}
                  >
                    Reprint
                  </Button>
                  {r.status !== 'refunded' && (
                    <Button
                      size="small"
                      danger
                      icon={<RollbackOutlined />}
                      onClick={() => loadFullSale(r.id, 'refund')}
                    >
                      Refund
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* Transaction Details Drawer */}
      <Drawer
        title={`Transaction Details — ${detailSale?.receipt_number ?? ''}`}
        open={Boolean(detailSale)}
        onClose={() => setDetailSale(null)}
        width={640}
        extra={
          detailSale && (
            <Space>
              <Button icon={<PrinterOutlined />} onClick={() => setReceiptSale(detailSale)}>
                Print Receipt
              </Button>
              {detailSale.status !== 'refunded' && (
                <Button
                  danger
                  icon={<RollbackOutlined />}
                  onClick={() => loadFullSale(detailSale.id, 'refund')}
                >
                  Process Refund
                </Button>
              )}
            </Space>
          )
        }
      >
        {detailSale && (
          <div className="space-y-4">
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Receipt #">
                <span className="font-mono-tabular font-semibold">
                  {detailSale.receipt_number}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Date">
                {formatDateTime(detailSale.created_at)}
              </Descriptions.Item>
              <Descriptions.Item label="Customer">
                {detailSale.customer_name || 'Walk-in Customer'}
              </Descriptions.Item>
              <Descriptions.Item label="Cashier">{detailSale.cashier_name}</Descriptions.Item>
              <Descriptions.Item label="Payment">
                {detailSale.payment_method.replace('_', ' ').toUpperCase()}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag
                  color={
                    detailSale.status === 'completed'
                      ? 'green'
                      : detailSale.status === 'refunded'
                        ? 'red'
                        : 'orange'
                  }
                >
                  {detailSale.status.replace('_', ' ')}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Paid">
                {formatCurrency(detailSale.paid_minor, settings)}
              </Descriptions.Item>
              <Descriptions.Item label="Change">
                {formatCurrency(detailSale.change_minor, settings)}
              </Descriptions.Item>
            </Descriptions>

            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detailSale.items ?? []}
              columns={[
                { title: 'Item', dataIndex: 'product_name' },
                {
                  title: 'Qty',
                  dataIndex: 'quantity',
                  align: 'right',
                  render: (q: number, r) => (
                    <span className="tabular-nums">
                      {q} {r.unit}
                      {r.refunded_qty > 0 ? ` (${r.refunded_qty} refunded)` : ''}
                    </span>
                  ),
                },
                {
                  title: 'Unit Price',
                  dataIndex: 'unit_price_minor',
                  align: 'right',
                  render: (v: number) => (
                    <span className="tabular-nums">{formatCurrency(v, settings)}</span>
                  ),
                },
                {
                  title: 'Subtotal',
                  dataIndex: 'line_subtotal_minor',
                  align: 'right',
                  render: (v: number) => (
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(v, settings)}
                    </span>
                  ),
                },
              ]}
            />

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">
                  {formatCurrency(detailSale.subtotal_minor, settings)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Discount</span>
                <span className="tabular-nums">
                  -{formatCurrency(detailSale.discount_amount_minor, settings)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span className="tabular-nums">
                  {formatCurrency(detailSale.tax_amount_minor, settings)}
                </span>
              </div>
              <div className="flex justify-between font-bold border-t border-slate-200 pt-1">
                <span>Grand Total</span>
                <span className="tabular-nums">
                  {formatCurrency(detailSale.total_minor, settings)}
                </span>
              </div>
            </div>

            {detailSale.refunds && detailSale.refunds.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 uppercase">
                  Refund Audit Trail
                </div>
                {detailSale.refunds.map((rfd) => (
                  <Alert
                    key={rfd.id}
                    type="warning"
                    message={`${rfd.refund_number} — ${formatCurrency(
                      rfd.total_refund_minor,
                      settings
                    )}`}
                    description={`Reason: ${rfd.reason} · Method: ${rfd.refund_method} · Restocked: ${
                      rfd.restock_items ? 'Yes' : 'No'
                    } · ${formatDateTime(rfd.created_at)}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Reprint Receipt Modal */}
      <Modal
        open={Boolean(receiptSale)}
        onCancel={() => setReceiptSale(null)}
        footer={null}
        title={`Reprint Receipt — ${receiptSale?.receipt_number ?? ''}`}
        width={680}
        destroyOnHidden
      >
        {receiptSale && settings && <ReceiptView sale={receiptSale} settings={settings} />}
      </Modal>

      {/* Refund Modal */}
      <Modal
        open={Boolean(refundTargetSale)}
        onCancel={() => setRefundTargetSale(null)}
        onOk={handleSubmitRefund}
        confirmLoading={refundMutation.isPending}
        title={`Process Refund — ${refundTargetSale?.receipt_number ?? ''}`}
        okText="Confirm Refund"
        okButtonProps={{ danger: true }}
        width={640}
        destroyOnHidden
      >
        {refundTargetSale && (
          <div className="space-y-4">
            <Alert
              type="info"
              showIcon
              message="Historical sale records remain preserved. Refunds create separate audit and inventory restock entries."
            />

            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={(refundTargetSale.items ?? []).filter(
                (i) => i.quantity - i.refunded_qty > 0
              )}
              columns={[
                { title: 'Product', dataIndex: 'product_name' },
                {
                  title: 'Available to Refund',
                  key: 'avail',
                  align: 'right',
                  render: (_: unknown, r) => (
                    <span className="tabular-nums">{r.quantity - r.refunded_qty}</span>
                  ),
                },
                {
                  title: 'Refund Qty',
                  key: 'qty',
                  align: 'right',
                  render: (_: unknown, r) => {
                    const max = r.quantity - r.refunded_qty;
                    return (
                      <InputNumber
                        min={0}
                        max={max}
                        size="small"
                        value={refundQuantities[r.id] ?? 0}
                        onChange={(v) =>
                          setRefundQuantities((prev) => ({
                            ...prev,
                            [r.id]: typeof v === 'number' ? v : 0,
                          }))
                        }
                        className="w-20! tabular-nums"
                      />
                    );
                  },
                },
              ]}
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">Refund Method</div>
                <Select
                  className="w-full"
                  value={refundMethod}
                  onChange={(v) => setRefundMethod(v)}
                  options={[
                    { label: 'Cash', value: 'cash' },
                    { label: 'Card', value: 'card' },
                    { label: 'Mobile Wallet', value: 'mobile_wallet' },
                    { label: 'Other', value: 'other' },
                  ]}
                />
              </div>
              <div className="flex items-end pb-1">
                <Checkbox
                  checked={restockItems}
                  onChange={(e) => setRestockItems(e.target.checked)}
                >
                  Restock returned items into inventory
                </Checkbox>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Refund Reason</div>
              <Input.TextArea
                rows={2}
                placeholder="e.g. Customer returned unopened item, expired batch, damaged seal..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
