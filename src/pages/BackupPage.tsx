import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Table,
  Upload,
  message,
} from 'antd';
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupPayload } from '../../backend/src/modules/backup/backup.service.ts';
import { ApiClientError, api } from '../services/api.ts';
import { formatDateTime } from '../utils/currency.ts';

export function BackupPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [parsedBackup, setParsedBackup] = useState<BackupPayload | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: safetyBackups = [], refetch: refetchSafety } = useQuery({
    queryKey: ['safety-backups'],
    queryFn: api.listSafetyBackups,
  });

  const exportMutation = useMutation({
    mutationFn: api.exportBackup,
    onSuccess: (payload) => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bazaarledger-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      messageApi.success('Full database backup exported');
    },
    onError: () => {
      messageApi.error('Failed to export backup');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: (res) => {
      messageApi.success(
        `Backup restored (${res.restored_counts.products} products, ${res.restored_counts.sales} sales)`
      );
      setConfirmOpen(false);
      setParsedBackup(null);
      setSelectedFilename('');
      refetchSafety();
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      messageApi.error(
        err instanceof ApiClientError ? err.message : 'Backup restoration failed'
      );
    },
  });

  const handleFileRead = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        if (
          !json ||
          json.app !== 'BazaarLedger POS' ||
          json.schema_version !== 1 ||
          !json.data ||
          !Array.isArray(json.data.products) ||
          !Array.isArray(json.data.sales)
        ) {
          messageApi.error('Unrecognized or invalid BazaarLedger backup file format');
          return;
        }
        setParsedBackup(json as BackupPayload);
        setSelectedFilename(file.name);
        setConfirmOpen(true);
      } catch {
        messageApi.error('Corrupt JSON file: unable to parse backup');
      }
    };
    reader.readAsText(file);
    return false; // Prevent antd auto-upload
  };

  return (
    <div className="max-w-4xl space-y-4">
      {contextHolder}

      <Alert
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Local Offline Storage & Atomic Backup Protection"
        description="All business data is stored locally in SQLite (./data/pos.sqlite). Before any backup restoration runs, BazaarLedger automatically saves a pre-restore safety snapshot to ./data/backups/ and restores all tables inside a single atomic transaction."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          title="Export Application Backup"
          className="border-slate-200 shadow-none"
          size="small"
        >
          <p className="text-sm text-slate-600 mb-4">
            Download a complete snapshot including categories, products, customers, sales,
            receipts, refunds, inventory movements, settings, and audit logs.
          </p>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            Download Full JSON Backup (v1)
          </Button>
        </Card>

        <Card
          title="Restore from Backup File"
          className="border-slate-200 shadow-none"
          size="small"
        >
          <p className="text-sm text-slate-600 mb-4">
            Select a previously exported <code className="text-xs">.json</code> backup file
            (schema version 1). The file is validated before modifying the database.
          </p>
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={handleFileRead}
          >
            <Button icon={<CloudUploadOutlined />}>Select Backup File to Restore</Button>
          </Upload>
        </Card>
      </div>

      <Card
        title="Automatic Pre-Restore Safety Backups on Disk"
        className="border-slate-200 shadow-none"
        size="small"
      >
        <Table
          rowKey="filename"
          size="small"
          pagination={false}
          dataSource={safetyBackups}
          locale={{ emptyText: 'No pre-restore safety backups created yet.' }}
          columns={[
            {
              title: 'Filename',
              dataIndex: 'filename',
              render: (v: string) => <span className="font-mono-tabular text-xs">{v}</span>,
            },
            {
              title: 'Size',
              dataIndex: 'size_bytes',
              align: 'right',
              render: (bytes: number) => (
                <span className="tabular-nums">{(bytes / 1024).toFixed(1)} KB</span>
              ),
            },
            {
              title: 'Created',
              dataIndex: 'created_at',
              render: (v: string) => <span className="text-xs">{formatDateTime(v)}</span>,
            },
          ]}
        />
      </Card>

      <Card
        title="Backup Compatibility & Storage Documentation"
        className="border-slate-200 shadow-none"
        size="small"
      >
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="SQLite Database Path">
            <span className="font-mono-tabular text-xs">./data/pos.sqlite</span>
          </Descriptions.Item>
          <Descriptions.Item label="Safety Backup Directory">
            <span className="font-mono-tabular text-xs">./data/backups/</span>
          </Descriptions.Item>
          <Descriptions.Item label="Backup Format Version">
            Schema Version 1 (BazaarLedger POS JSON Snapshot)
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Modal
        title="Confirm Database Restoration"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onOk={() => parsedBackup && restoreMutation.mutate(parsedBackup)}
        okText="Restore Database Now"
        okButtonProps={{ danger: true }}
        confirmLoading={restoreMutation.isPending}
      >
        {parsedBackup && (
          <Space direction="vertical" className="w-full" size="middle">
            <Alert
              type="warning"
              showIcon
              message="This will replace current live data with the selected backup."
              description="A safety backup of your current database will be saved automatically first."
            />
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="File" span={2}>
                {selectedFilename}
              </Descriptions.Item>
              <Descriptions.Item label="Exported At" span={2}>
                {formatDateTime(parsedBackup.exported_at)}
              </Descriptions.Item>
              <Descriptions.Item label="Products">
                {parsedBackup.data.products.length}
              </Descriptions.Item>
              <Descriptions.Item label="Categories">
                {parsedBackup.data.categories.length}
              </Descriptions.Item>
              <Descriptions.Item label="Sales">
                {parsedBackup.data.sales.length}
              </Descriptions.Item>
              <Descriptions.Item label="Customers">
                {parsedBackup.data.customers.length}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Modal>
    </div>
  );
}
