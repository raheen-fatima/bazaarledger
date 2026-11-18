import { useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryDTO } from '../../shared/types.ts';
import { ApiClientError, api } from '../services/api.ts';

interface CategoryFormValues {
  name: string;
  description: string;
  color: string;
}

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<CategoryFormValues>();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryDTO | null>(null);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.listCategories(true),
  });

  const saveMutation = useMutation({
    mutationFn: (values: CategoryFormValues) => {
      if (editing) {
        return api.updateCategory(editing.id, values);
      }
      return api.createCategory(values);
    },
    onSuccess: () => {
      messageApi.success(editing ? 'Category updated' : 'Category created');
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err) => {
      messageApi.error(err instanceof ApiClientError ? err.message : 'Failed to save category');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: (res) => {
      messageApi.success(
        res.archived
          ? 'Category archived because products reference it'
          : 'Category deleted'
      );
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err) => {
      messageApi.error(err instanceof Error ? err.message : 'Failed to delete category');
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ color: '#1d4ed8', description: '' });
    setModalOpen(true);
  };

  const openEdit = (cat: CategoryDTO) => {
    setEditing(cat);
    form.setFieldsValue({
      name: cat.name,
      description: cat.description,
      color: cat.color || '#1d4ed8',
    });
    setModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {contextHolder}

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Organize supermarket inventory into clear product departments.
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Category
        </Button>
      </div>

      <Card className="border-slate-200 shadow-none" size="small">
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={categories}
          pagination={false}
          columns={[
            {
              title: 'Category',
              dataIndex: 'name',
              render: (name: string, r: CategoryDTO) => (
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-xs shrink-0"
                    style={{ backgroundColor: r.color || '#1d4ed8' }}
                  />
                  <span className="font-medium text-slate-900">{name}</span>
                </div>
              ),
            },
            { title: 'Description', dataIndex: 'description' },
            {
              title: 'Active Products',
              dataIndex: 'product_count',
              align: 'right',
              render: (cnt: number) => <span className="tabular-nums">{cnt ?? 0}</span>,
            },
            {
              title: 'Status',
              dataIndex: 'is_active',
              render: (active: number) =>
                active === 1 ? <Tag color="green">Active</Tag> : <Tag>Archived</Tag>,
            },
            {
              title: 'Actions',
              key: 'actions',
              align: 'right',
              render: (_: unknown, r: CategoryDTO) => (
                <Space size="small">
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                  <Popconfirm
                    title="Delete or archive this category?"
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

      <Modal
        title={editing ? `Edit Category — ${editing.name}` : 'New Category'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
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
            label="Category Name"
            name="name"
            rules={[{ required: true, message: 'Category name is required' }]}
          >
            <Input placeholder="e.g. Fresh Produce" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Department description..." />
          </Form.Item>
          <Form.Item
            label="Color Hex"
            name="color"
            rules={[{ pattern: /^#[0-9a-fA-F]{6}$/, message: 'Use 6-digit hex color e.g. #1d4ed8' }]}
          >
            <Input type="color" className="w-20! h-9! p-1!" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
