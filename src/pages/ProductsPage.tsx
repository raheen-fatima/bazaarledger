import { useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductDTO } from '../../shared/types.ts';
import { ApiClientError, api } from '../services/api.ts';
import { formatCurrency, toMajorUnits, toMinorUnits } from '../utils/currency.ts';

interface ProductFormValues {
  name: string;
  barcode: string;
  sku: string;
  category_id: number | null;
  purchase_price_major: number;
  selling_price_major: number;
  stock_qty: number;
  min_stock_threshold: number;
  unit: string;
  description: string;
  is_active: boolean;
}

const UNIT_OPTIONS = ['pcs', 'kg', 'g', 'L', 'ml', 'pack', 'box', 'dozen'].map((u) => ({
  label: u,
  value: u,
}));

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ProductFormValues>();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortDir, setSortDir] = useState<string>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDTO | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.listCategories(false),
  });

  const { data: productsData, isLoading } = useQuery({
    queryKey: [
      'products',
      search,
      categoryFilter,
      statusFilter,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
    queryFn: () =>
      api.listProducts({
        search: search || undefined,
        category_id: categoryFilter,
        status: statusFilter,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
      }),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      if (editingProduct) {
        return api.updateProduct(editingProduct.id, {
          name: values.name,
          barcode: values.barcode,
          sku: values.sku,
          category_id: values.category_id ?? null,
          purchase_price_minor: toMinorUnits(values.purchase_price_major),
          selling_price_minor: toMinorUnits(values.selling_price_major),
          min_stock_threshold: values.min_stock_threshold,
          unit: values.unit,
          description: values.description ?? '',
          is_active: values.is_active,
        });
      }
      return api.createProduct({
        name: values.name,
        barcode: values.barcode,
        sku: values.sku,
        category_id: values.category_id ?? null,
        purchase_price_minor: toMinorUnits(values.purchase_price_major),
        selling_price_minor: toMinorUnits(values.selling_price_major),
        stock_qty: values.stock_qty ?? 0,
        min_stock_threshold: values.min_stock_threshold ?? 5,
        unit: values.unit,
        description: values.description ?? '',
        is_active: values.is_active,
      });
    },
    onSuccess: () => {
      messageApi.success(editingProduct ? 'Product updated' : 'Product created');
      setDrawerOpen(false);
      setEditingProduct(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        messageApi.error(err.message);
      } else {
        messageApi.error('Failed to save product');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteOrArchiveProduct,
    onSuccess: (res) => {
      messageApi.success(
        res.archived
          ? 'Product archived (preserved for historical receipts)'
          : 'Product permanently deleted'
      );
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      messageApi.error(err instanceof Error ? err.message : 'Delete failed');
    },
  });

  const openCreateDrawer = () => {
    setEditingProduct(null);
    form.resetFields();
    form.setFieldsValue({
      unit: 'pcs',
      stock_qty: 0,
      min_stock_threshold: 5,
      is_active: true,
      category_id: categories[0]?.id ?? null,
    });
    setDrawerOpen(true);
  };

  const openEditDrawer = (product: ProductDTO) => {
    setEditingProduct(product);
    form.setFieldsValue({
      name: product.name,
      barcode: product.barcode,
      sku: product.sku,
      category_id: product.category_id,
      purchase_price_major: toMajorUnits(product.purchase_price_minor),
      selling_price_major: toMajorUnits(product.selling_price_minor),
      stock_qty: product.stock_qty,
      min_stock_threshold: product.min_stock_threshold,
      unit: product.unit,
      description: product.description,
      is_active: product.is_active === 1,
    });
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-4">
      {contextHolder}

      <Card className="border-slate-200 shadow-none" size="small">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined className="text-slate-400" />}
              placeholder="Search name, barcode, or SKU..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-64!"
            />
            <Select
              allowClear
              placeholder="All Categories"
              value={categoryFilter}
              onChange={(val) => {
                setCategoryFilter(val);
                setPage(1);
              }}
              className="w-44!"
              options={categories.map((c) => ({ label: c.name, value: c.id }))}
            />
            <Select
              value={statusFilter}
              onChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
              className="w-40!"
              options={[
                { label: 'Active Products', value: 'active' },
                { label: 'Low Stock', value: 'low_stock' },
                { label: 'Out of Stock', value: 'out_of_stock' },
                { label: 'Archived', value: 'inactive' },
                { label: 'All Products', value: 'all' },
              ]}
            />
          </Space>

          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDrawer}>
            Add Product
          </Button>
        </div>
      </Card>

      <Card className="border-slate-200 shadow-none" size="small">
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={productsData?.items ?? []}
          scroll={{ x: 900 }}
          onChange={(_pagination, _filters, sorter) => {
            if (!Array.isArray(sorter) && sorter.field) {
              setSortBy(String(sorter.field));
              setSortDir(sorter.order === 'descend' ? 'desc' : 'asc');
            }
          }}
          pagination={{
            current: page,
            pageSize,
            total: productsData?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: ['15', '30', '50'],
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          columns={[
            {
              title: 'Product',
              dataIndex: 'name',
              sorter: true,
              render: (name: string, r: ProductDTO) => (
                <div>
                  <div className="font-medium text-slate-900">{name}</div>
                  <div className="text-xs text-slate-500 font-mono-tabular">
                    SKU: {r.sku} · Barcode: {r.barcode}
                  </div>
                </div>
              ),
            },
            {
              title: 'Category',
              dataIndex: 'category_name',
              render: (val: string | null) => val || <span className="text-slate-400">—</span>,
            },
            {
              title: 'Cost',
              dataIndex: 'purchase_price_minor',
              align: 'right',
              render: (val: number) => (
                <span className="tabular-nums text-slate-600">
                  {formatCurrency(val, settings)}
                </span>
              ),
            },
            {
              title: 'Selling Price',
              dataIndex: 'selling_price_minor',
              align: 'right',
              sorter: true,
              render: (val: number) => (
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatCurrency(val, settings)}
                </span>
              ),
            },
            {
              title: 'Stock',
              dataIndex: 'stock_qty',
              align: 'right',
              sorter: true,
              render: (qty: number, r: ProductDTO) => (
                <span className="tabular-nums font-medium">
                  {qty} {r.unit}
                </span>
              ),
            },
            {
              title: 'Status',
              key: 'status',
              render: (_: unknown, r: ProductDTO) => {
                if (r.is_active === 0) return <Tag color="default">Archived</Tag>;
                if (r.stock_qty <= 0) return <Tag color="red">Out of Stock</Tag>;
                if (r.stock_qty <= r.min_stock_threshold) return <Tag color="orange">Low Stock</Tag>;
                return <Tag color="green">In Stock</Tag>;
              },
            },
            {
              title: 'Actions',
              key: 'actions',
              align: 'right',
              render: (_: unknown, r: ProductDTO) => (
                <Space size="small">
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditDrawer(r)}
                  >
                    Edit
                  </Button>
                  <Popconfirm
                    title={
                      r.is_active === 1
                        ? 'Delete or archive this product?'
                        : 'Delete archived product?'
                    }
                    description="Products linked to past sales will be safely archived."
                    onConfirm={() => deleteMutation.mutate(r.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={editingProduct ? `Edit Product — ${editingProduct.name}` : 'Add New Product'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => saveMutation.mutate(values)}
        >
          <Form.Item
            label="Product Name"
            name="name"
            rules={[{ required: true, message: 'Enter product name' }]}
          >
            <Input placeholder="e.g. Olpers Full Cream Milk 1L" />
          </Form.Item>

          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="Barcode (Unique)"
              name="barcode"
              rules={[{ required: true, message: 'Barcode is required' }]}
            >
              <Input placeholder="8961003021015" className="font-mono-tabular" />
            </Form.Item>

            <Form.Item
              label="SKU / Code (Unique)"
              name="sku"
              rules={[{ required: true, message: 'SKU is required' }]}
            >
              <Input placeholder="DAI-1001" className="font-mono-tabular" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="Category" name="category_id">
              <Select
                allowClear
                placeholder="Select category"
                options={categories.map((c) => ({ label: c.name, value: c.id }))}
              />
            </Form.Item>

            <Form.Item
              label="Unit"
              name="unit"
              rules={[{ required: true }]}
            >
              <Select options={UNIT_OPTIONS} />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label={`Purchase Price (${settings?.currency_code ?? 'PKR'})`}
              name="purchase_price_major"
              rules={[{ required: true, message: 'Required' }]}
            >
              <InputNumber min={0} step={1} precision={2} className="w-full! tabular-nums" />
            </Form.Item>

            <Form.Item
              label={`Selling Price (${settings?.currency_code ?? 'PKR'})`}
              name="selling_price_major"
              rules={[{ required: true, message: 'Required' }]}
            >
              <InputNumber min={0} step={1} precision={2} className="w-full! tabular-nums" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!editingProduct && (
              <Form.Item
                label="Initial Stock Qty"
                name="stock_qty"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={1} precision={0} className="w-full! tabular-nums" />
              </Form.Item>
            )}

            <Form.Item
              label="Min Stock Alert Threshold"
              name="min_stock_threshold"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} step={1} precision={0} className="w-full! tabular-nums" />
            </Form.Item>
          </div>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional product details..." />
          </Form.Item>

          <Form.Item label="Active for POS Sales" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              {editingProduct ? 'Save Changes' : 'Create Product'}
            </Button>
          </div>
        </Form>
      </Drawer>
    </div>
  );
}
