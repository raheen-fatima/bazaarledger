import { useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import {
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomerDTO, SaleDTO } from '../../shared/types.ts';
import { ApiClientError, api } from '../services/api.ts';
import { formatCurrency, formatDateTime } from '../utils/currency.ts';
import { ReceiptView } from '../components/ReceiptView.tsx';

interface CustomerFormValues {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<CustomerFormValues>();

  const [search, setSearch] = useState('');
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDTO | null>(null);
  const [historyCustomerId, setHistoryCustomerId] = useState<number | null>(null);
  const [receiptSale, setReceiptSale] = useState<SaleDTO | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => api.listCustomers(search || undefined),
  });

  const { data: customerDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['customer-detail', historyCustomerId],
    queryFn: () => api.getCustomerDetail(historyCustomerId!),
    enabled: Boolean(historyCustomerId),
  });

  const saveMutation = useMutation({
    mutationFn: (values: CustomerFormValues) => {
      const payload = {
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        address: values.address || '',
        notes: values.notes || '',
      };
      if (editing) {
        return api.updateCustomer(editing.id, payload);
      }
      return api.createCustomer(payload);
    },
    onSuccess: () => {
      messageApi.success(editing ? 'Customer updated' : 'Customer added');
      setFormModalOpen(false);
      setEditing(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => {
      messageApi.error(err instanceof ApiClientError ? err.message : 'Failed to save customer');
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormModalOpen(true);
  };

  const openEdit = (customer: CustomerDTO) => {
    setEditing(customer);
    form.setFieldsValue({
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      address: customer.address,
      notes: customer.notes,
    });
    setFormModalOpen(true);
  };

  const openReceipt = async (saleId: number) => {
    const fullSale = await api.getSale(saleId);
    setReceiptSale(fullSale);
  };

  return (
    <div className="space-y-4">
      {contextHolder}

      <Card className="border-slate-200 shadow-none" size="small">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="Search customer by name, phone, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72!"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Customer
          </Button>
        </div>
      </Card>

      <Card className="border-slate-200 shadow-none" size="small">
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={customers}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: 'Customer Name',
              dataIndex: 'name',
              render: (name: string) => <span className="font-medium text-slate-900">{name}</span>,
            },
            {
              title: 'Phone',
              dataIndex: 'phone',
              render: (phone: string | null) =>
                phone ? <span className="font-mono-tabular">{phone}</span> : '—',
            },
            { title: 'Address', dataIndex: 'address', render: (v: string) => v || '—' },
            {
              title: 'Visits',
              dataIndex: 'visit_count',
              align: 'right',
              render: (v: number) => <span className="tabular-nums">{v ?? 0}</span>,
            },
            {
              title: 'Total Spent',
              dataIndex: 'total_spent_minor',
              align: 'right',
              render: (v: number) => (
                <span className="font-semibold tabular-nums">
                  {formatCurrency(v ?? 0, settings)}
                </span>
              ),
            },
            {
              title: 'Actions',
              key: 'actions',
              align: 'right',
              render: (_: unknown, r: CustomerDTO) => (
                <Space size="small">
                  <Button
                    size="small"
                    icon={<HistoryOutlined />}
                    onClick={() => setHistoryCustomerId(r.id)}
                  >
                    Purchases
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? `Edit Customer — ${editing.name}` : 'Add Customer'}
        open={formModalOpen}
        onCancel={() => setFormModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => saveMutation.mutate(values)}
        >
          <Form.Item
            label="Full Name"
            name="name"
            rules={[{ required: true, message: 'Customer name is required' }]}
          >
            <Input placeholder="e.g. Muhammad Tariq" />
          </Form.Item>
          <Form.Item label="Phone Number" name="phone">
            <Input placeholder="e.g. 0300-4128901" className="font-mono-tabular" />
          </Form.Item>
          <Form.Item label="Email" name="email">
            <Input placeholder="Optional email address" />
          </Form.Item>
          <Form.Item label="Address" name="address">
            <Input.TextArea rows={2} placeholder="Street, area, city..." />
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input placeholder="Customer preferences or account notes" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          customerDetail
            ? `Purchase History — ${customerDetail.customer.name}`
            : 'Customer Purchase History'
        }
        open={Boolean(historyCustomerId)}
        onClose={() => setHistoryCustomerId(null)}
        width={620}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loadingDetail}
          dataSource={customerDetail?.sales ?? []}
          pagination={{ pageSize: 15 }}
          locale={{ emptyText: 'No purchases recorded for this customer yet.' }}
          columns={[
            {
              title: 'Receipt #',
              dataIndex: 'receipt_number',
              render: (v: string) => <span className="font-mono-tabular font-medium">{v}</span>,
            },
            {
              title: 'Date',
              dataIndex: 'created_at',
              render: (v: string) => <span className="text-xs">{formatDateTime(v)}</span>,
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
              title: '',
              key: 'view',
              align: 'right',
              render: (_: unknown, r: SaleDTO) => (
                <Button size="small" onClick={() => openReceipt(r.id)}>
                  Receipt
                </Button>
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        open={Boolean(receiptSale)}
        onCancel={() => setReceiptSale(null)}
        footer={null}
        title={`Receipt — ${receiptSale?.receipt_number ?? ''}`}
        width={680}
        destroyOnHidden
      >
        {receiptSale && settings && <ReceiptView sale={receiptSale} settings={settings} />}
      </Modal>
    </div>
  );
}
