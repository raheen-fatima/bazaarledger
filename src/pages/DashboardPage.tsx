import { Card, Col, Row, Table, Tag, Button, Empty, Skeleton, Alert } from 'antd';
import {
  ShoppingCartOutlined,
  WarningOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api.ts';
import { formatCurrency, formatDateTime } from '../utils/currency.ts';

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const {
    data: dashboard,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton active paragraph={{ rows: 4 }} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <Alert
        type="error"
        showIcon
        message="Unable to load dashboard metrics"
        description={error instanceof Error ? error.message : 'Database connection error'}
      />
    );
  }

  const maxChartVal = Math.max(
    1,
    ...dashboard.daily_chart.map((d) => Math.max(d.net_sales_minor, d.gross_profit_minor))
  );

  return (
    <div className="space-y-5">
      {/* Primary KPI Row */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="border-slate-200 shadow-none" size="small">
            <div className="text-xs font-medium text-slate-500">Today&apos;s Net Sales</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCurrency(dashboard.today.net_sales_minor, settings)}
            </div>
            <div className="mt-2 text-xs text-slate-500 tabular-nums">
              {dashboard.today.sales_count} transactions · Gross Profit{' '}
              {formatCurrency(dashboard.today.gross_profit_minor, settings)}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="border-slate-200 shadow-none" size="small">
            <div className="text-xs font-medium text-slate-500">Total Transactions</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {dashboard.overall.total_transactions.toLocaleString()}
            </div>
            <div className="mt-2 text-xs text-slate-500 tabular-nums">
              7-day: {dashboard.weekly_summary.sales_count} · Month:{' '}
              {dashboard.monthly_summary.sales_count}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="border-slate-200 shadow-none" size="small">
            <div className="text-xs font-medium text-slate-500">Total Net Revenue</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCurrency(dashboard.overall.total_revenue_minor, settings)}
            </div>
            <div className="mt-2 text-xs text-slate-500 tabular-nums">
              Month Net:{' '}
              {formatCurrency(dashboard.monthly_summary.net_sales_minor, settings)}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="border-slate-200 shadow-none" size="small">
            <div className="text-xs font-medium text-slate-500">Products in Inventory</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {dashboard.overall.active_products}
            </div>
            <div className="mt-2 text-xs text-slate-500 tabular-nums">
              {dashboard.overall.total_stock_units.toLocaleString()} total units ·{' '}
              <span
                className={
                  dashboard.overall.low_stock_count > 0
                    ? 'font-semibold text-amber-700'
                    : 'text-slate-500'
                }
              >
                {dashboard.overall.low_stock_count} low stock
              </span>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Period Summaries & Sales Chart */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title="14-Day Sales & Gross Profit Performance"
            className="border-slate-200 shadow-none"
            size="small"
            extra={
              <Button type="link" size="small" onClick={() => navigate('/reports')}>
                Detailed Reports <ArrowRightOutlined />
              </Button>
            }
          >
            {dashboard.daily_chart.length === 0 ? (
              <div className="py-10">
                <Empty
                  description="No completed sales recorded in the last 14 days yet."
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    onClick={() => navigate('/pos')}
                  >
                    Process First Sale
                  </Button>
                </Empty>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-center gap-4 text-xs text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-xs bg-blue-700" />
                    Net Sales
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                    Gross Profit
                  </span>
                </div>
                <div className="flex h-48 items-end gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
                  {dashboard.daily_chart.map((point) => {
                    const salesPct = Math.max(
                      4,
                      Math.round((point.net_sales_minor / maxChartVal) * 100)
                    );
                    const profitPct = Math.max(
                      0,
                      Math.round((Math.max(0, point.gross_profit_minor) / maxChartVal) * 100)
                    );
                    return (
                      <div
                        key={point.date}
                        className="flex min-w-[44px] flex-1 flex-col items-center gap-1"
                        title={`${point.date}: Net ${formatCurrency(
                          point.net_sales_minor,
                          settings
                        )} | Profit ${formatCurrency(point.gross_profit_minor, settings)} (${
                          point.sales_count
                        } sales)`}
                      >
                        <div className="flex h-36 w-full items-end justify-center gap-1">
                          <div
                            className="w-3.5 rounded-t-xs bg-blue-700 transition-all"
                            style={{ height: `${salesPct}%` }}
                          />
                          <div
                            className="w-3.5 rounded-t-xs bg-emerald-600 transition-all"
                            style={{ height: `${profitPct}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                          {point.date.slice(5)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title="Period Summaries & Stock Value"
            className="border-slate-200 shadow-none h-full"
            size="small"
          >
            <div className="divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-medium text-slate-800">Today</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {dashboard.today.sales_count} orders
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-semibold text-slate-900">
                    {formatCurrency(dashboard.today.net_sales_minor, settings)}
                  </div>
                  <div className="text-xs text-emerald-700">
                    Profit {formatCurrency(dashboard.today.gross_profit_minor, settings)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-medium text-slate-800">Last 7 Days</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {dashboard.weekly_summary.sales_count} orders
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-semibold text-slate-900">
                    {formatCurrency(dashboard.weekly_summary.net_sales_minor, settings)}
                  </div>
                  <div className="text-xs text-emerald-700">
                    Profit {formatCurrency(dashboard.weekly_summary.gross_profit_minor, settings)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-medium text-slate-800">This Month</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {dashboard.monthly_summary.sales_count} orders
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-semibold text-slate-900">
                    {formatCurrency(dashboard.monthly_summary.net_sales_minor, settings)}
                  </div>
                  <div className="text-xs text-emerald-700">
                    Profit {formatCurrency(dashboard.monthly_summary.gross_profit_minor, settings)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3">
                <div>
                  <div className="font-medium text-slate-800">Inventory Cost Value</div>
                  <div className="text-xs text-slate-500">
                    Retail:{' '}
                    {formatCurrency(dashboard.overall.inventory_retail_value_minor, settings)}
                  </div>
                </div>
                <div className="font-semibold text-slate-900 tabular-nums">
                  {formatCurrency(dashboard.overall.inventory_cost_value_minor, settings)}
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Tables Row */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="Recent Transactions"
            className="border-slate-200 shadow-none"
            size="small"
            extra={
              <Button type="link" size="small" onClick={() => navigate('/sales')}>
                View All
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={dashboard.recent_transactions}
              locale={{ emptyText: 'No transactions recorded yet.' }}
              columns={[
                {
                  title: 'Receipt #',
                  dataIndex: 'receipt_number',
                  render: (val: string) => (
                    <span className="font-mono-tabular font-medium text-slate-900">{val}</span>
                  ),
                },
                {
                  title: 'Customer',
                  dataIndex: 'customer_name',
                  render: (val: string | null) => val || 'Walk-in',
                },
                {
                  title: 'Method',
                  dataIndex: 'payment_method',
                  render: (val: string) => <span className="capitalize">{val.replace('_', ' ')}</span>,
                },
                {
                  title: 'Total',
                  dataIndex: 'total_minor',
                  align: 'right',
                  render: (val: number) => (
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(val, settings)}
                    </span>
                  ),
                },
                {
                  title: 'Date',
                  dataIndex: 'created_at',
                  render: (val: string) => (
                    <span className="text-xs text-slate-500">{formatDateTime(val)}</span>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <span className="flex items-center gap-2">
                <WarningOutlined className="text-amber-600" />
                Low Stock Alerts &amp; Best Sellers
              </span>
            }
            className="border-slate-200 shadow-none"
            size="small"
            extra={
              <Button type="link" size="small" onClick={() => navigate('/inventory')}>
                Manage Stock
              </Button>
            }
          >
            {dashboard.low_stock_products.length > 0 ? (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={dashboard.low_stock_products}
                columns={[
                  {
                    title: 'Product',
                    dataIndex: 'name',
                    render: (name: string, r) => (
                      <div>
                        <div className="font-medium text-slate-900">{name}</div>
                        <div className="text-xs text-slate-500">{r.sku}</div>
                      </div>
                    ),
                  },
                  {
                    title: 'Stock',
                    dataIndex: 'stock_qty',
                    align: 'right',
                    render: (qty: number, r) => (
                      <Tag color={qty <= 0 ? 'red' : 'orange'} className="tabular-nums">
                        {qty} {r.unit}
                      </Tag>
                    ),
                  },
                  {
                    title: 'Min',
                    dataIndex: 'min_stock_threshold',
                    align: 'right',
                    render: (min: number) => <span className="tabular-nums">{min}</span>,
                  },
                ]}
              />
            ) : (
              <div className="py-4 text-center text-sm text-slate-500">
                All active products are above their minimum stock threshold.
              </div>
            )}

            {dashboard.best_selling.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="mb-2 text-xs font-semibold text-slate-600">
                  Best-Selling Products
                </div>
                <Table
                  size="small"
                  rowKey="product_id"
                  pagination={false}
                  dataSource={dashboard.best_selling}
                  columns={[
                    { title: 'Product', dataIndex: 'product_name' },
                    {
                      title: 'Sold',
                      dataIndex: 'units_sold',
                      align: 'right',
                      render: (v: number) => <span className="tabular-nums">{v}</span>,
                    },
                    {
                      title: 'Revenue',
                      dataIndex: 'revenue_minor',
                      align: 'right',
                      render: (v: number) => (
                        <span className="font-medium tabular-nums">
                          {formatCurrency(v, settings)}
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
