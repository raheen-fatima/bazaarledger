import { useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import { SwapOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InventoryMovementDTO, ProductDTO } from '../../shared/types.ts';
import { ApiClientError, api } from '../services/api.ts';
import { formatDateTime } from '../utils/currency.ts';

interface AdjustFormValues {
  product_id: number;
  adjustment_type: 'add' | 'remove' | 'set';
  quantity: number;
  reason: string;
  authorized_by: string;
  notes: string;
  allow_negative_override: boolean;
}

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  initial: { label: 'Initial Stock', color: 'blue' },
  sale: { label: 'POS Sale', color: 'volcano' },
  restock: { label: 'Restock', color: 'green' },
  adjustment_in: { label: 'Adjustment (+)', color: 'cyan' },
  adjustment_out: { label: 'Adjustment (-)', color: 'orange' },
  refund_restock: { label: 'Refund Restock', color: 'purple' },
  backup_restore: { label: 'Backup Restore', color: 'default' },
};

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<AdjustFormValues>();

  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [movementFilter, setMovementFilter] = useState<string>('all');
  const [movPage, setMovPage] = useState(1);

  const { data: productsData, isLoading: loadingStock } = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => api.listProducts({ status: 'active', page: 1, page_size: 200 }),
  });

  const { data: lowStock = [] } = useQuery({
    queryKey: ['inventory-low-stock'],
    queryFn: api.getLowStockProducts,
  });

  const { data: movementsData, isLoading: loadingMovements } = useQuery({
    queryKey: ['inventory-movements', movementFilter, movPage],
    queryFn: () =>
      api.listMovements({
        movement_type: movementFilter,
        page: movPage,
        page_size: 25,
      }),
  });

  const adjustMutation = useMutation({
    mutationFn: api.adjustStock,
    onSuccess: (res) => {
      messageApi.success(
        `Stock updated for ${res.product.name}: now ${res.product.stock_qty} ${res.product.unit}`
      );
      setAdjustModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        messageApi.error(err.message);
      } else {
        messageApi.error('Stock adjustment failed');
      }
    },
  });

  const openAdjustForProduct = (product?: ProductDTO) => {
    form.resetFields();
    form.setFieldsValue({
      product_id: product?.id,
      adjustment_type: 'add',
      quantity: 10,
      authorized_by: 'Store Manager',
      allow_negative_override: false,
    });
    setAdjustModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {contextHolder}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Every stock addition, sale deduction, return, and manual correction is logged immutably.
        </div>
        <Button
          type="primary"
          icon={<SwapOutlined />}
          onClick={() => openAdjustForProduct()}
        >
          Adjust / Restock Inventory
        </Button>
      </div>

      <Card className="border-slate-200 shadow-none" size="small">
        <Tabs
          items={[
            {
              key: 'stock',
              label: `Current Stock (${productsData?.items.length ?? 0})`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  loading={loadingStock}
                  dataSource={productsData?.items ?? []}
                  pagination={{ pageSize: 20 }}
                  columns={[
                    {
                      title: 'Product',
                      dataIndex: 'name',
                      render: (name: string, r: ProductDTO) => (
                        <div>
                          <div className="font-medium text-slate-900">{name}</div>
                          <div className="text-xs text-slate-500 font-mono-tabular">
                            {r.sku} · {r.barcode}
                          </div>
                        </div>
                      ),
                    },
                    { title: 'Category', dataIndex: 'category_name' },
                    {
                      title: 'Current Stock',
                      dataIndex: 'stock_qty',
                      align: 'right',
                      render: (qty: number, r: ProductDTO) => (
                        <span className="font-semibold tabular-nums">
                          {qty} {r.unit}
                        </span>
                      ),
                    },
                    {
                      title: 'Min Threshold',
                      dataIndex: 'min_stock_threshold',
                      align: 'right',
                      render: (min: number, r: ProductDTO) => (
                        <span className="tabular-nums text-slate-600">
                          {min} {r.unit}
                        </span>
                      ),
                    },
                    {
                      title: 'Status',
                      key: 'status',
                      render: (_: unknown, r: ProductDTO) => {
                        if (r.stock_qty <= 0) return <Tag color="red">Out of Stock</Tag>;
                        if (r.stock_qty <= r.min_stock_threshold)
                          return <Tag color="orange">Low Stock</Tag>;
                        return <Tag color="green">Healthy</Tag>;
                      },
                    },
                    {
                      title: 'Action',
                      key: 'action',
                      align: 'right',
                      render: (_: unknown, r: ProductDTO) => (
                        <Button size="small" onClick={() => openAdjustForProduct(r)}>
                          Adjust Stock
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'low_stock',
              label: (
                <span className="flex items-center gap-1.5">
                  <WarningOutlined className={lowStock.length > 0 ? 'text-amber-600' : ''} />
                  Low Stock Alerts ({lowStock.length})
                </span>
              ),
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={lowStock}
                  pagination={false}
                  locale={{ emptyText: 'No products below minimum threshold' }}
                  columns={[
                    { title: 'Product', dataIndex: 'name' },
                    { title: 'SKU', dataIndex: 'sku' },
                    {
                      title: 'Remaining',
                      dataIndex: 'stock_qty',
                      align: 'right',
                      render: (qty: number, r: ProductDTO) => (
                        <Tag color={qty <= 0 ? 'red' : 'orange'} className="tabular-nums">
                          {qty} {r.unit}
                        </Tag>
                      ),
                    },
                    {
                      title: 'Minimum',
                      dataIndex: 'min_stock_threshold',
                      align: 'right',
                    },
                    {
                      title: 'Action',
                      key: 'act',
                      align: 'right',
                      render: (_: unknown, r: ProductDTO) => (
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => openAdjustForProduct(r)}
                        >
                          Restock
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'movements',
              label: 'Movement Ledger',
              children: (
                <div className="space-y-3">
                  <Space>
                    <Select
                      value={movementFilter}
                      onChange={(val) => {
                        setMovementFilter(val);
                        setMovPage(1);
                      }}
                      className="w-48!"
                      options={[
                        { label: 'All Movements', value: 'all' },
                        { label: 'POS Sales', value: 'sale' },
                        { label: 'Restock', value: 'restock' },
                        { label: 'Adjustments (+)', value: 'adjustment_in' },
                        { label: 'Adjustments (-)', value: 'adjustment_out' },
                        { label: 'Refund Restock', value: 'refund_restock' },
                      ]}
                    />
                  </Space>

                  <Table
                    rowKey="id"
                    size="small"
                    loading={loadingMovements}
                    dataSource={movementsData?.items ?? []}
                    pagination={{
                      current: movPage,
                      pageSize: 25,
                      total: movementsData?.total ?? 0,
                      onChange: setMovPage,
                    }}
                    columns={[
                      {
                        title: 'Date',
                        dataIndex: 'created_at',
                        render: (v: string) => (
                          <span className="text-xs text-slate-600">{formatDateTime(v)}</span>
                        ),
                      },
                      {
                        title: 'Product',
                        dataIndex: 'product_name',
                        render: (name: string, r: InventoryMovementDTO) => (
                          <div>
                            <div className="font-medium">{name}</div>
                            <div className="text-xs text-slate-500 font-mono-tabular">
                              {r.product_sku}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: 'Type',
                        dataIndex: 'movement_type',
                        render: (t: string) => {
                          const meta = MOVEMENT_LABELS[t] ?? { label: t, color: 'default' };
                          return <Tag color={meta.color}>{meta.label}</Tag>;
                        },
                      },
                      {
                        title: 'Delta',
                        dataIndex: 'quantity_delta',
                        align: 'right',
                        render: (d: number) => (
                          <span
                            className={`font-semibold tabular-nums ${
                              d >= 0 ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {d >= 0 ? `+${d}` : d}
                          </span>
                        ),
                      },
                      {
                        title: 'Before → After',
                        key: 'balance',
                        align: 'right',
                        render: (_: unknown, r: InventoryMovementDTO) => (
                          <span className="tabular-nums text-slate-600">
                            {r.stock_before} → <strong>{r.stock_after}</strong>
                          </span>
                        ),
                      },
                      { title: 'Reason', dataIndex: 'reason' },
                      { title: 'By', dataIndex: 'performed_by' },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Stock Adjustment / Restock"
        open={adjustModalOpen}
        onCancel={() => setAdjustModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adjustMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => adjustMutation.mutate(values)}
        >
          <Form.Item
            label="Product"
            name="product_id"
            rules={[{ required: true, message: 'Select a product' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Choose product"
              options={(productsData?.items ?? []).map((p) => ({
                value: p.id,
                label: `${p.name} (Current: ${p.stock_qty} ${p.unit})`,
              }))}
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="Adjustment Type"
              name="adjustment_type"
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { label: 'Add Stock (Restock)', value: 'add' },
                  { label: 'Remove Stock (Damage / Loss)', value: 'remove' },
                  { label: 'Set Exact Count (Audit)', value: 'set' },
                ]}
              />
            </Form.Item>

            <Form.Item
              label="Quantity"
              name="quantity"
              rules={[{ required: true, message: 'Enter quantity' }]}
            >
              <InputNumber min={0} step={1} precision={0} className="w-full! tabular-nums" />
            </Form.Item>
          </div>

          <Form.Item
            label="Reason"
            name="reason"
            rules={[{ required: true, message: 'Reason is required for audit trail' }]}
          >
            <Input placeholder="e.g. Supplier delivery #402, Damaged pack, Physical count" />
          </Form.Item>

          <Form.Item
            label="Authorized By"
            name="authorized_by"
            rules={[{ required: true }]}
          >
            <Input placeholder="Store Manager" />
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={2} placeholder="Optional additional notes..." />
          </Form.Item>

          <Form.Item name="allow_negative_override" valuePropName="checked">
            <Checkbox>
              Authorized negative-stock override (use only for emergency reconciliation)
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
