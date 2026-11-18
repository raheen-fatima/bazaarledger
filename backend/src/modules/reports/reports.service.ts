import type Database from 'better-sqlite3';
import type { DashboardSummary, ProductDTO, SaleDTO } from '../../../../shared/types.ts';

export interface SalesReportResult {
  period: {
    from: string;
    to: string;
  };
  financials: {
    transactions_count: number;
    gross_sales_minor: number;
    discounts_minor: number;
    taxes_minor: number;
    refunds_minor: number;
    net_sales_minor: number;
    cogs_minor: number;
    gross_profit_minor: number;
  };
  payment_methods: Array<{
    payment_method: string;
    transactions_count: number;
    total_minor: number;
  }>;
  daily_breakdown: Array<{
    date: string;
    transactions_count: number;
    gross_sales_minor: number;
    discounts_minor: number;
    taxes_minor: number;
    refunds_minor: number;
    net_sales_minor: number;
    gross_profit_minor: number;
  }>;
  best_selling_products: Array<{
    product_id: number;
    product_name: string;
    sku: string;
    units_sold: number;
    revenue_minor: number;
    profit_minor: number;
  }>;
  least_selling_products: Array<{
    product_id: number;
    product_name: string;
    sku: string;
    stock_qty: number;
    units_sold: number;
    revenue_minor: number;
  }>;
  inventory_valuation: {
    total_active_products: number;
    total_units_in_stock: number;
    total_cost_value_minor: number;
    total_retail_value_minor: number;
    potential_margin_minor: number;
  };
  low_stock_products: ProductDTO[];
}

export class ReportsService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private getPeriodMetrics(dateFromSql: string, dateToSql?: string): {
    sales_count: number;
    gross_sales_minor: number;
    discounts_minor: number;
    taxes_minor: number;
    refunds_minor: number;
    net_sales_minor: number;
    cogs_minor: number;
    gross_profit_minor: number;
  } {
    const toCondition = dateToSql ? `AND date(created_at) <= date(?)` : '';
    const args = dateToSql ? [dateFromSql, dateToSql] : [dateFromSql];

    const salesAgg = this.db
      .prepare(
        `SELECT
           COUNT(*) as sales_count,
           COALESCE(SUM(subtotal_minor), 0) as gross_sales_minor,
           COALESCE(SUM(discount_amount_minor), 0) as discounts_minor,
           COALESCE(SUM(tax_amount_minor), 0) as taxes_minor,
           COALESCE(SUM(total_minor), 0) as total_billed_minor
         FROM sales
         WHERE date(created_at) >= date(?) ${toCondition}`
      )
      .get(...args) as {
      sales_count: number;
      gross_sales_minor: number;
      discounts_minor: number;
      taxes_minor: number;
      total_billed_minor: number;
    };

    const refundsAgg = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(total_refund_minor), 0) as refunds_minor,
           COALESCE(SUM(tax_refund_minor), 0) as tax_refund_minor
         FROM refunds
         WHERE date(created_at) >= date(?) ${toCondition}`
      )
      .get(...args) as {
      refunds_minor: number;
      tax_refund_minor: number;
    };

    const cogsToCondition = dateToSql ? `AND date(s.created_at) <= date(?)` : '';
    const cogsRow = this.db
      .prepare(
        `SELECT
           COALESCE(SUM((si.quantity - si.refunded_qty) * si.purchase_price_minor), 0) as cogs_minor
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE date(s.created_at) >= date(?) ${cogsToCondition}`
      )
      .get(...args) as { cogs_minor: number };

    // Net sales = (gross_sales - discounts - (refunds - tax_refunds)) excluding collected sales tax
    const netTaxMinor = Math.max(0, salesAgg.taxes_minor - refundsAgg.tax_refund_minor);
    const netSalesMinor =
      salesAgg.total_billed_minor - refundsAgg.refunds_minor - netTaxMinor;
    const grossProfitMinor = netSalesMinor - cogsRow.cogs_minor;

    return {
      sales_count: salesAgg.sales_count,
      gross_sales_minor: salesAgg.gross_sales_minor,
      discounts_minor: salesAgg.discounts_minor,
      taxes_minor: salesAgg.taxes_minor,
      refunds_minor: refundsAgg.refunds_minor,
      net_sales_minor: netSalesMinor,
      cogs_minor: cogsRow.cogs_minor,
      gross_profit_minor: grossProfitMinor,
    };
  }

  public getDashboardSummary(): DashboardSummary {
    const todayRow = this.db.prepare(`SELECT date('now') as d`).get() as { d: string };
    const today = todayRow.d;

    const weekStartRow = this.db
      .prepare(`SELECT date('now', '-6 days') as d`)
      .get() as { d: string };
    const monthStartRow = this.db
      .prepare(`SELECT date('now', 'start of month') as d`)
      .get() as { d: string };

    const todayMetrics = this.getPeriodMetrics(today, today);
    const weeklyMetrics = this.getPeriodMetrics(weekStartRow.d, today);
    const monthlyMetrics = this.getPeriodMetrics(monthStartRow.d, today);
    const allTimeMetrics = this.getPeriodMetrics('1970-01-01');

    const invStats = this.db
      .prepare(
        `SELECT
           COUNT(*) as active_products,
           COALESCE(SUM(stock_qty), 0) as total_stock_units,
           SUM(CASE WHEN stock_qty <= min_stock_threshold THEN 1 ELSE 0 END) as low_stock_count,
           SUM(CASE WHEN stock_qty <= 0 THEN 1 ELSE 0 END) as out_of_stock_count,
           COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * purchase_price_minor ELSE 0 END), 0) as inventory_cost_value_minor,
           COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * selling_price_minor ELSE 0 END), 0) as inventory_retail_value_minor
         FROM products
         WHERE is_active = 1`
      )
      .get() as {
      active_products: number;
      total_stock_units: number;
      low_stock_count: number;
      out_of_stock_count: number;
      inventory_cost_value_minor: number;
      inventory_retail_value_minor: number;
    };

    // Last 14 days daily chart
    const dailyRows = this.db
      .prepare(
        `SELECT
           date(s.created_at) as date,
           COUNT(*) as sales_count,
           COALESCE(SUM(s.total_minor - s.tax_amount_minor), 0) as net_before_refunds_minor
         FROM sales s
         WHERE date(s.created_at) >= date('now', '-13 days')
         GROUP BY date(s.created_at)
         ORDER BY date ASC`
      )
      .all() as Array<{
      date: string;
      sales_count: number;
      net_before_refunds_minor: number;
    }>;

    const dailyRefundMap = new Map<string, number>();
    const refundRows = this.db
      .prepare(
        `SELECT date(created_at) as date, COALESCE(SUM(total_refund_minor - tax_refund_minor), 0) as rfd
         FROM refunds
         WHERE date(created_at) >= date('now', '-13 days')
         GROUP BY date(created_at)`
      )
      .all() as Array<{ date: string; rfd: number }>;
    for (const r of refundRows) {
      dailyRefundMap.set(r.date, r.rfd);
    }

    const dailyCogsMap = new Map<string, number>();
    const cogsRows = this.db
      .prepare(
        `SELECT date(s.created_at) as date,
                COALESCE(SUM((si.quantity - si.refunded_qty) * si.purchase_price_minor), 0) as cogs
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE date(s.created_at) >= date('now', '-13 days')
         GROUP BY date(s.created_at)`
      )
      .all() as Array<{ date: string; cogs: number }>;
    for (const c of cogsRows) {
      dailyCogsMap.set(c.date, c.cogs);
    }

    const dailyChart = dailyRows.map((d) => {
      const rfd = dailyRefundMap.get(d.date) ?? 0;
      const cogs = dailyCogsMap.get(d.date) ?? 0;
      const net = d.net_before_refunds_minor - rfd;
      return {
        date: d.date,
        sales_count: d.sales_count,
        net_sales_minor: net,
        gross_profit_minor: net - cogs,
      };
    });

    const bestSelling = this.db
      .prepare(
        `SELECT
           si.product_id,
           si.product_name,
           si.sku,
           SUM(si.quantity - si.refunded_qty) as units_sold,
           SUM((si.quantity - si.refunded_qty) * si.unit_price_minor) as revenue_minor
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE (si.quantity - si.refunded_qty) > 0
         GROUP BY si.product_id
         ORDER BY units_sold DESC, revenue_minor DESC
         LIMIT 5`
      )
      .all() as DashboardSummary['best_selling'];

    const lowStockProducts = this.db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1 AND p.stock_qty <= p.min_stock_threshold
         ORDER BY p.stock_qty ASC, p.name ASC
         LIMIT 8`
      )
      .all() as ProductDTO[];

    const recentTransactions = this.db
      .prepare(
        `SELECT s.*, c.name as customer_name, c.phone as customer_phone
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ORDER BY s.id DESC
         LIMIT 8`
      )
      .all() as SaleDTO[];

    return {
      today: {
        sales_count: todayMetrics.sales_count,
        gross_sales_minor: todayMetrics.gross_sales_minor,
        discounts_minor: todayMetrics.discounts_minor,
        taxes_minor: todayMetrics.taxes_minor,
        refunds_minor: todayMetrics.refunds_minor,
        net_sales_minor: todayMetrics.net_sales_minor,
        gross_profit_minor: todayMetrics.gross_profit_minor,
      },
      overall: {
        total_transactions: allTimeMetrics.sales_count,
        total_revenue_minor: allTimeMetrics.net_sales_minor,
        active_products: invStats.active_products,
        total_stock_units: invStats.total_stock_units,
        low_stock_count: invStats.low_stock_count ?? 0,
        out_of_stock_count: invStats.out_of_stock_count ?? 0,
        inventory_cost_value_minor: invStats.inventory_cost_value_minor,
        inventory_retail_value_minor: invStats.inventory_retail_value_minor,
      },
      weekly_summary: {
        sales_count: weeklyMetrics.sales_count,
        net_sales_minor: weeklyMetrics.net_sales_minor,
        gross_profit_minor: weeklyMetrics.gross_profit_minor,
      },
      monthly_summary: {
        sales_count: monthlyMetrics.sales_count,
        net_sales_minor: monthlyMetrics.net_sales_minor,
        gross_profit_minor: monthlyMetrics.gross_profit_minor,
      },
      daily_chart: dailyChart,
      best_selling: bestSelling,
      low_stock_products: lowStockProducts,
      recent_transactions: recentTransactions,
    };
  }

  public getSalesReport(dateFrom: string, dateTo: string): SalesReportResult {
    const metrics = this.getPeriodMetrics(dateFrom, dateTo);

    const paymentMethods = this.db
      .prepare(
        `SELECT
           payment_method,
           COUNT(*) as transactions_count,
           COALESCE(SUM(total_minor), 0) as total_minor
         FROM sales
         WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
         GROUP BY payment_method
         ORDER BY total_minor DESC`
      )
      .all(dateFrom, dateTo) as SalesReportResult['payment_methods'];

    const dailySales = this.db
      .prepare(
        `SELECT
           date(created_at) as date,
           COUNT(*) as transactions_count,
           COALESCE(SUM(subtotal_minor), 0) as gross_sales_minor,
           COALESCE(SUM(discount_amount_minor), 0) as discounts_minor,
           COALESCE(SUM(tax_amount_minor), 0) as taxes_minor,
           COALESCE(SUM(total_minor), 0) as total_billed_minor
         FROM sales
         WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
         GROUP BY date(created_at)
         ORDER BY date DESC`
      )
      .all(dateFrom, dateTo) as Array<{
      date: string;
      transactions_count: number;
      gross_sales_minor: number;
      discounts_minor: number;
      taxes_minor: number;
      total_billed_minor: number;
    }>;

    const refundsByDay = new Map<string, { total: number; tax: number }>();
    const rRows = this.db
      .prepare(
        `SELECT date(created_at) as date,
                COALESCE(SUM(total_refund_minor), 0) as total,
                COALESCE(SUM(tax_refund_minor), 0) as tax
         FROM refunds
         WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
         GROUP BY date(created_at)`
      )
      .all(dateFrom, dateTo) as Array<{ date: string; total: number; tax: number }>;
    for (const r of rRows) {
      refundsByDay.set(r.date, { total: r.total, tax: r.tax });
    }

    const cogsByDay = new Map<string, number>();
    const cRows = this.db
      .prepare(
        `SELECT date(s.created_at) as date,
                COALESCE(SUM((si.quantity - si.refunded_qty) * si.purchase_price_minor), 0) as cogs
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
         GROUP BY date(s.created_at)`
      )
      .all(dateFrom, dateTo) as Array<{ date: string; cogs: number }>;
    for (const c of cRows) {
      cogsByDay.set(c.date, c.cogs);
    }

    const dailyBreakdown = dailySales.map((d) => {
      const rfd = refundsByDay.get(d.date) ?? { total: 0, tax: 0 };
      const cogs = cogsByDay.get(d.date) ?? 0;
      const netTax = Math.max(0, d.taxes_minor - rfd.tax);
      const netSales = d.total_billed_minor - rfd.total - netTax;
      return {
        date: d.date,
        transactions_count: d.transactions_count,
        gross_sales_minor: d.gross_sales_minor,
        discounts_minor: d.discounts_minor,
        taxes_minor: d.taxes_minor,
        refunds_minor: rfd.total,
        net_sales_minor: netSales,
        gross_profit_minor: netSales - cogs,
      };
    });

    const bestSellingProducts = this.db
      .prepare(
        `SELECT
           si.product_id,
           si.product_name,
           si.sku,
           SUM(si.quantity - si.refunded_qty) as units_sold,
           SUM((si.quantity - si.refunded_qty) * si.unit_price_minor) as revenue_minor,
           SUM((si.quantity - si.refunded_qty) * (si.unit_price_minor - si.purchase_price_minor)) as profit_minor
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
           AND (si.quantity - si.refunded_qty) > 0
         GROUP BY si.product_id
         ORDER BY units_sold DESC, revenue_minor DESC
         LIMIT 20`
      )
      .all(dateFrom, dateTo) as SalesReportResult['best_selling_products'];

    const leastSellingProducts = this.db
      .prepare(
        `SELECT
           p.id as product_id,
           p.name as product_name,
           p.sku,
           p.stock_qty,
           COALESCE(SUM(CASE
             WHEN date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
             THEN (si.quantity - si.refunded_qty)
             ELSE 0
           END), 0) as units_sold,
           COALESCE(SUM(CASE
             WHEN date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
             THEN (si.quantity - si.refunded_qty) * si.unit_price_minor
             ELSE 0
           END), 0) as revenue_minor
         FROM products p
         LEFT JOIN sale_items si ON si.product_id = p.id
         LEFT JOIN sales s ON s.id = si.sale_id
         WHERE p.is_active = 1
         GROUP BY p.id
         ORDER BY units_sold ASC, p.stock_qty DESC
         LIMIT 20`
      )
      .all(dateFrom, dateTo, dateFrom, dateTo) as SalesReportResult['least_selling_products'];

    const invVal = this.db
      .prepare(
        `SELECT
           COUNT(*) as total_active_products,
           COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty ELSE 0 END), 0) as total_units_in_stock,
           COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * purchase_price_minor ELSE 0 END), 0) as total_cost_value_minor,
           COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * selling_price_minor ELSE 0 END), 0) as total_retail_value_minor
         FROM products
         WHERE is_active = 1`
      )
      .get() as {
      total_active_products: number;
      total_units_in_stock: number;
      total_cost_value_minor: number;
      total_retail_value_minor: number;
    };

    const lowStockProducts = this.db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1 AND p.stock_qty <= p.min_stock_threshold
         ORDER BY p.stock_qty ASC, p.name ASC`
      )
      .all() as ProductDTO[];

    return {
      period: { from: dateFrom, to: dateTo },
      financials: {
        transactions_count: metrics.sales_count,
        gross_sales_minor: metrics.gross_sales_minor,
        discounts_minor: metrics.discounts_minor,
        taxes_minor: metrics.taxes_minor,
        refunds_minor: metrics.refunds_minor,
        net_sales_minor: metrics.net_sales_minor,
        cogs_minor: metrics.cogs_minor,
        gross_profit_minor: metrics.gross_profit_minor,
      },
      payment_methods: paymentMethods,
      daily_breakdown: dailyBreakdown,
      best_selling_products: bestSellingProducts,
      least_selling_products: leastSellingProducts,
      inventory_valuation: {
        ...invVal,
        potential_margin_minor:
          invVal.total_retail_value_minor - invVal.total_cost_value_minor,
      },
      low_stock_products: lowStockProducts,
    };
  }
}
