import { useEffect } from 'react';
import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Switch,
  message,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENCY_PRESETS } from '../../shared/money.ts';
import type { AppSettings, PaperWidth, PaymentMethod } from '../../shared/types.ts';
import { api } from '../services/api.ts';

interface SettingsFormValues {
  shop_name: string;
  shop_address: string;
  shop_phone: string;
  shop_tax_id: string;
  currency_code: string;
  currency_symbol: string;
  tax_rate_percent: number;
  tax_inclusive: boolean;
  tax_label: string;
  receipt_header: string;
  receipt_footer: string;
  receipt_paper_width: PaperWidth;
  default_payment_method: PaymentMethod;
  allow_negative_inventory: boolean;
  default_cashier_name: string;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<SettingsFormValues>();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        shop_name: settings.shop_name,
        shop_address: settings.shop_address,
        shop_phone: settings.shop_phone,
        shop_tax_id: settings.shop_tax_id,
        currency_code: settings.currency_code,
        currency_symbol: settings.currency_symbol,
        tax_rate_percent: settings.tax_rate_bps / 100,
        tax_inclusive: settings.tax_inclusive,
        tax_label: settings.tax_label,
        receipt_header: settings.receipt_header,
        receipt_footer: settings.receipt_footer,
        receipt_paper_width: settings.receipt_paper_width,
        default_payment_method: settings.default_payment_method,
        allow_negative_inventory: settings.allow_negative_inventory,
        default_cashier_name: settings.default_cashier_name,
      });
    }
  }, [settings, form]);

  const saveMutation = useMutation({
    mutationFn: (values: SettingsFormValues) => {
      const payload: Partial<AppSettings> = {
        shop_name: values.shop_name,
        shop_address: values.shop_address,
        shop_phone: values.shop_phone,
        shop_tax_id: values.shop_tax_id,
        currency_code: values.currency_code,
        currency_symbol: values.currency_symbol,
        tax_rate_bps: Math.round((values.tax_rate_percent ?? 0) * 100),
        tax_inclusive: values.tax_inclusive,
        tax_label: values.tax_label,
        receipt_header: values.receipt_header,
        receipt_footer: values.receipt_footer,
        receipt_paper_width: values.receipt_paper_width,
        default_payment_method: values.default_payment_method,
        allow_negative_inventory: values.allow_negative_inventory,
        default_cashier_name: values.default_cashier_name,
      };
      return api.updateSettings(payload);
    },
    onSuccess: () => {
      messageApi.success('Store settings saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      messageApi.error(err instanceof Error ? err.message : 'Failed to save settings');
    },
  });

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <div className="max-w-4xl space-y-4">
      {contextHolder}

      <Card className="border-slate-200 shadow-none" size="small">
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => saveMutation.mutate(values)}
        >
          <div className="text-sm font-semibold text-slate-900 mb-3">
            Store &amp; Receipt Identity
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              label="Shop / Supermarket Name"
              name="shop_name"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="Phone Number" name="shop_phone">
              <Input />
            </Form.Item>
            <Form.Item label="Shop Address" name="shop_address">
              <Input />
            </Form.Item>
            <Form.Item label="Tax / NTN Registration Number" name="shop_tax_id">
              <Input />
            </Form.Item>
          </div>

          <Divider />

          <div className="text-sm font-semibold text-slate-900 mb-3">
            Currency &amp; Tax Configuration
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Form.Item label="Currency Preset" name="currency_code">
              <Select
                onChange={(code: string) => {
                  const preset = CURRENCY_PRESETS[code];
                  if (preset) {
                    form.setFieldValue('currency_symbol', preset.symbol);
                  }
                }}
                options={Object.values(CURRENCY_PRESETS).map((c) => ({
                  label: `${c.code} (${c.symbol})`,
                  value: c.code,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Currency Symbol"
              name="currency_symbol"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="Tax Label" name="tax_label" rules={[{ required: true }]}>
              <Input placeholder="GST / VAT" />
            </Form.Item>
            <Form.Item label="Tax Rate (%)" name="tax_rate_percent">
              <InputNumber min={0} max={50} step={0.5} precision={2} className="w-full!" />
            </Form.Item>
          </div>

          <Form.Item
            label="Prices Include Tax (Tax-Inclusive Pricing)"
            name="tax_inclusive"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Divider />

          <div className="text-sm font-semibold text-slate-900 mb-3">
            POS Register, Receipt &amp; Inventory Preferences
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Form.Item label="Receipt Paper Width" name="receipt_paper_width">
              <Select
                options={[
                  { label: '58mm Thermal Roll', value: '58mm' },
                  { label: '80mm Thermal Roll', value: '80mm' },
                  { label: 'Standard A4 Sheet', value: 'a4' },
                ]}
              />
            </Form.Item>

            <Form.Item label="Default Payment Method" name="default_payment_method">
              <Select
                options={[
                  { label: 'Cash', value: 'cash' },
                  { label: 'Card', value: 'card' },
                  { label: 'Mobile Wallet', value: 'mobile_wallet' },
                  { label: 'Other', value: 'other' },
                ]}
              />
            </Form.Item>

            <Form.Item
              label="Default Cashier / Counter Name"
              name="default_cashier_name"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item label="Receipt Header Tagline" name="receipt_header">
              <Input />
            </Form.Item>
            <Form.Item label="Receipt Footer Thank-You Message" name="receipt_footer">
              <Input />
            </Form.Item>
          </div>

          <Form.Item
            label="Allow Negative Inventory at Checkout (Not recommended for strict stock control)"
            name="allow_negative_inventory"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <div className="pt-2">
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saveMutation.isPending}
            >
              Save Settings
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
