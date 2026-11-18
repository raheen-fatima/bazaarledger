import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../services/api.ts';
import { downloadCsv, formatCurrency, toMajorUnits } from '../utils/currency.ts';

type PresetPeriod = 'today' | 'week' | 'month' | 'custom';

export function ReportsPage() {
  const [preset, setPreset] = useState<PresetPeriod>('month');
  const [customRange, setCustomRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'),
    dayjs(),
  ]);

  const { from, to } = (() => {
    const now = dayjs();
    if (preset === 'today') return { from: now.format('YYYY-MM-DD'), to: now.format('YYYY-MM-DD') };
    if (preset === 'week')
      return { from: now.subtract(6, 'day').format('YYYY-MM-DD'), to: now.format('YYYY-MM-DD') };
    if (preset === 'month')
      return { from: now.startOf('month').format('YYYY-MM-DD'), to: now.format('YYYY-MM-DD') };
    return {
      from: customRange[0].format('YYYY-MM-DD'),
      to: customRange[1].format('YYYY-MM-DD'),
    };
  })();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const { data: report, isLoading } = useQuery({
    queryKey: ['reports', from, to],
    queryFn: () => api.getSalesReport(from, to),
  });

  const exportDailyCsv = () => {
    if (!report) return;
    downloadCsv(
      `bazaarledger-sales-report-${from}-to-${to}.csv`,
      [
        'Date',
        'Transactions',
        'Gross Sales',
        'Discounts',
        'Taxes',
        'Refunds',
        'Net Sales',
        'Gross Profit',
      ],
      report.daily_breakdown.map((d) => [
        d.date,
        d.transactions_count,
        toMajorUnits(d.gross_sales_minor).toFixed(2),
        toMajorUnits(d.discounts_minor).toFixed(2),
        toMajorUnits(d.taxes_minor).toFixed(2),
        toMajorUnits(d.refunds_minor).toFixed(2),
        toMajorUnits(d.net_sales_minor).toFixed(2),
        toMajorUnits(d.gross_profit_minor).toFixed(2),
      ])
    );
  };

  const exportLowStockCsv = () => {
    if (!report) return;
    downloadCsv(
      `bazaarledger-low-stock-${to}.csv`,
      ['SKU', 'Barcode', 'Product', 'Category', 'Current Stock', 'Min Threshold', 'Unit'],
      report.low_stock_products.map((p) => [
        p.sku,
        p.barcode,
        p.name,
        p.category_name ?? '',
        p.stock_qty,
        p.min_stock_threshold,
        p.unit,
      ])
    );
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-none" size="small">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Space wrap>
            <Segmented
              value={preset}
              onChange={(val) => setPreset(val as PresetPeriod)}
              options={[
                { label: 'Today', value: 'today' },
                { label: 'Last 7 Days', value: 'week' },
                { label: 'This Month', value: 'month' },
                { label: 'Custom Range', value: 'custom' },
              ]}
            />
            {preset === 'custom' && (
              <DatePicker.RangePicker
                allowClear={false}
                value={customRange}
                onChange={(vals) => {
                  if (vals && vals[0] && vals[1]) {
                    setCustomRange([vals[0], vals[1]]);
                  }
                }}
              />
            )}
          </Space>

          <Space>
            <Button icon={<DownloadOutlined />} onClick={exportDailyCsv} disabled={!report}>
              Export Sales CSV
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportLowStockCsv} disabled={!report}>
              Export Low-Stock CSV
            </Button>
          </Space>
        </div>
      </Card>

      {isLoading || !report ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          {/* Distinct Financial Separation */}
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <Card className="border-slate-200 shadow-none" size="small">
                <div className="text-xs text-slate-500">Gross Sales (Before Discounts)</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                  {formatCurrency(report.financials.gross_sales_minor, settings)}
                </div>
                <div className="mt-1 text-xs text-slate-500 tabular-nums">
                  {report.financials.transactions_count} transactions
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="border-slate-200 shadow-none" size="small">
                <div className="text-xs text-slate-500">Discounts, Taxes &amp; Refunds</div>
                <div className="mt-1 text-sm space-y-0.5 tabular-nums">
                  <div className="flex justify-between">
                    <span>Discounts:</span>
                    <span className="text-amber-700">
                      -{formatCurrency(report.financials.discounts_minor, settings)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Refunds:</span>
                    <span className="text-red-600">
                      -{formatCurrency(report.financials.refunds_minor, settings)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Taxes Collected:</span>
                    <span>{formatCurrency(report.financials.taxes_minor, settings)}</span>
                  </div>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="border-slate-200 shadow-none" size="small">
                <div className="text-xs text-slate-500">Net Sales Revenue (Excl. Tax)</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-blue-800">
                  {formatCurrency(report.financials.net_sales_minor, settings)}
                </div>
                <div className="mt-1 text-xs text-slate-500 tabular-nums">
                  COGS: {formatCurrency(report.financials.cogs_minor, settings)}
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="border-slate-200 shadow-none" size="small">
                <div className="text-xs text-slate-500">Gross Profit (Net Sales - COGS)</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
                  {formatCurrency(report.financials.gross_profit_minor, settings)}
                </div>
                <div className="mt-1 text-xs text-slate-500 tabular-nums">
                  Margin:{' '}
                  {report.financials.net_sales_minor > 0
                    ? `${(
                        (report.financials.gross_profit_minor /
                          report.financials.net_sales_minor) *
                        100
                      ).toFixed(1)}%`
                    : '0.0%'}
                </div>
              </Card>
            </Col>
          </Row>

          {/* Payment Summary & Inventory Valuation */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Payment Method Summary" className="border-slate-200 shadow-none" size="small">
                <Table
                  rowKey="payment_method"
                  size="small"
                  pagination={false}
                  dataSource={report.payment_methods}
                  columns={[
                    {
                      title: 'Method',
                      dataIndex: 'payment_method',
                      render: (v: string) => (
                        <span className="capitalize font-medium">{v.replace('_', ' ')}</span>
                      ),
                    },
                    {
                      title: 'Transactions',
                      dataIndex: 'transactions_count',
                      align: 'right',
                      render: (v: number) => <span className="tabular-nums">{v}</span>,
                    },
                    {
                      title: 'Collected Total',
                      dataIndex: 'total_minor',
                      align: 'right',
                      render: (v: number) => (
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(v, settings)}
                        </span>
                      ),
                    },
                  ]}
                />
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="Current Inventory Valuation" className="border-slate-200 shadow-none" size="small">
                <div className="divide-y divide-slate-100 text-sm">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600">Active SKUs / Total Stock Units</span>
                    <span className="font-semibold tabular-nums">
                      {report.inventory_valuation.total_active_products} SKUs ·{' '}
                      {report.inventory_valuation.total_units_in_stock.toLocaleString()} units
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600">Inventory Cost Value (Purchase Price)</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(report.inventory_valuation.total_cost_value_minor, settings)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600">Inventory Retail Value (Selling Price)</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(report.inventory_valuation.total_retail_value_minor, settings)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600">Projected Retail Margin</span>
                    <span className="font-semibold text-emerald-700 tabular-nums">
                      {formatCurrency(report.inventory_valuation.potential_margin_minor, settings)}
                    </span>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          {/* Detailed Report Tabs */}
          <Card className="border-slate-200 shadow-none" size="small">
            <Tabs
              items={[
                {
                  key: 'daily',
                  label: 'Daily Breakdown',
                  children: (
                    <Table
                      rowKey="date"
                      size="small"
                      pagination={{ pageSize: 15 }}
                      dataSource={report.daily_breakdown}
                      columns={[
                        { title: 'Date', dataIndex: 'date' },
                        {
                          title: 'Orders',
                          dataIndex: 'transactions_count',
                          align: 'right',
                          render: (v: number) => <span className="tabular-nums">{v}</span>,
                        },
                        {
                          title: 'Gross Sales',
                          dataIndex: 'gross_sales_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="tabular-nums">{formatCurrency(v, settings)}</span>
                          ),
                        },
                        {
                          title: 'Discounts',
                          dataIndex: 'discounts_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="tabular-nums">{formatCurrency(v, settings)}</span>
                          ),
                        },
                        {
                          title: 'Taxes',
                          dataIndex: 'taxes_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="tabular-nums">{formatCurrency(v, settings)}</span>
                          ),
                        },
                        {
                          title: 'Refunds',
                          dataIndex: 'refunds_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="tabular-nums text-red-600">
                              {formatCurrency(v, settings)}
                            </span>
                          ),
                        },
                        {
                          title: 'Net Sales',
                          dataIndex: 'net_sales_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="font-semibold tabular-nums">
                              {formatCurrency(v, settings)}
                            </span>
                          ),
                        },
                        {
                          title: 'Gross Profit',
                          dataIndex: 'gross_profit_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="font-semibold text-emerald-700 tabular-nums">
                              {formatCurrency(v, settings)}
                            </span>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'best',
                  label: 'Best-Selling Products',
                  children: (
                    <Table
                      rowKey="product_id"
                      size="small"
                      pagination={false}
                      dataSource={report.best_selling_products}
                      columns={[
                        { title: 'Product', dataIndex: 'product_name' },
                        { title: 'SKU', dataIndex: 'sku' },
                        {
                          title: 'Units Sold',
                          dataIndex: 'units_sold',
                          align: 'right',
                          render: (v: number) => <span className="tabular-nums">{v}</span>,
                        },
                        {
                          title: 'Revenue',
                          dataIndex: 'revenue_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="tabular-nums">{formatCurrency(v, settings)}</span>
                          ),
                        },
                        {
                          title: 'Gross Profit',
                          dataIndex: 'profit_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="font-semibold text-emerald-700 tabular-nums">
                              {formatCurrency(v, settings)}
                            </span>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'least',
                  label: 'Least-Selling Products',
                  children: (
                    <Table
                      rowKey="product_id"
                      size="small"
                      pagination={false}
                      dataSource={report.least_selling_products}
                      columns={[
                        { title: 'Product', dataIndex: 'product_name' },
                        { title: 'SKU', dataIndex: 'sku' },
                        {
                          title: 'Current Stock',
                          dataIndex: 'stock_qty',
                          align: 'right',
                          render: (v: number) => <span className="tabular-nums">{v}</span>,
                        },
                        {
                          title: 'Units Sold',
                          dataIndex: 'units_sold',
                          align: 'right',
                          render: (v: number) => <span className="tabular-nums">{v}</span>,
                        },
                        {
                          title: 'Revenue',
                          dataIndex: 'revenue_minor',
                          align: 'right',
                          render: (v: number) => (
                            <span className="tabular-nums">{formatCurrency(v, settings)}</span>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'low_stock',
                  label: `Low-Stock Report (${report.low_stock_products.length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={report.low_stock_products}
                      columns={[
                        { title: 'Product', dataIndex: 'name' },
                        { title: 'SKU', dataIndex: 'sku' },
                        { title: 'Category', dataIndex: 'category_name' },
                        {
                          title: 'Stock',
                          dataIndex: 'stock_qty',
                          align: 'right',
                          render: (v: number) => (
                            <Tag color={v <= 0 ? 'red' : 'orange'} className="tabular-nums">
                              {v}
                            </Tag>
                          ),
                        },
                        {
                          title: 'Min Threshold',
                          dataIndex: 'min_stock_threshold',
                          align: 'right',
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
