import { useState } from 'react';
import { Button, Segmented, Space, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import type { AppSettings, PaperWidth, SaleDTO } from '../../shared/types.ts';
import { formatCurrency, formatDateTime } from '../utils/currency.ts';

interface ReceiptViewProps {
  sale: SaleDTO;
  settings: AppSettings;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_wallet: 'Mobile Wallet',
  other: 'Other',
};

export function ReceiptView({ sale, settings }: ReceiptViewProps) {
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(
    settings.receipt_paper_width || '80mm'
  );

  const paperClass =
    paperWidth === '58mm'
      ? 'receipt-paper-58mm'
      : paperWidth === 'a4'
        ? 'receipt-paper-a4'
        : 'receipt-paper-80mm';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="no-print flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <Space size="small">
          <Typography.Text type="secondary" className="text-xs">
            Paper Format:
          </Typography.Text>
          <Segmented
            size="small"
            value={paperWidth}
            onChange={(val) => setPaperWidth(val as PaperWidth)}
            options={[
              { label: '58mm Thermal', value: '58mm' },
              { label: '80mm Thermal', value: '80mm' },
              { label: 'A4 Invoice', value: 'a4' },
            ]}
          />
        </Space>
        <Button type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>
          Print Receipt
        </Button>
      </div>

      <div className="flex w-full justify-center overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-4">
        <div
          id="printable-receipt"
          className={`${paperClass} bg-white p-4 text-slate-900 shadow-sm font-mono-tabular`}
        >
          {/* Shop Header */}
          <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
            <div className="text-base font-bold tracking-tight uppercase">
              {settings.shop_name}
            </div>
            {settings.receipt_header && (
              <div className="text-[11px] text-slate-600 mt-0.5">{settings.receipt_header}</div>
            )}
            {settings.shop_address && (
              <div className="text-[11px] mt-1">{settings.shop_address}</div>
            )}
            {settings.shop_phone && (
              <div className="text-[11px]">Tel: {settings.shop_phone}</div>
            )}
            {settings.shop_tax_id && (
              <div className="text-[11px]">Tax ID: {settings.shop_tax_id}</div>
            )}
          </div>

          {/* Invoice Meta */}
          <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-400 pb-2 mb-2">
            <div className="flex justify-between">
              <span>Receipt #:</span>
              <span className="font-bold">{sale.receipt_number}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{formatDateTime(sale.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier:</span>
              <span>{sale.cashier_name}</span>
            </div>
            <div className="flex justify-between">
              <span>Customer:</span>
              <span>{sale.customer_name || 'Walk-in Customer'}</span>
            </div>
            {sale.status !== 'completed' && (
              <div className="flex justify-between font-bold uppercase text-red-700 pt-0.5">
                <span>Status:</span>
                <span>{sale.status.replace('_', ' ')}</span>
              </div>
            )}
          </div>

          {/* Items Table */}
          <table className="w-full border-collapse text-[11px] mb-2">
            <thead>
              <tr className="border-b border-slate-400 text-left">
                <th className="py-1 font-bold">Item</th>
                <th className="py-1 text-right font-bold">Qty</th>
                <th className="py-1 text-right font-bold">Price</th>
                <th className="py-1 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dotted divide-slate-300">
              {(sale.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="py-1 pr-1 align-top">
                    <div className="font-semibold leading-tight">{item.product_name}</div>
                    {paperWidth !== '58mm' && (
                      <div className="text-[10px] text-slate-500">{item.sku}</div>
                    )}
                    {item.refunded_qty > 0 && (
                      <div className="text-[10px] text-red-600">
                        Refunded: {item.refunded_qty} {item.unit}
                      </div>
                    )}
                  </td>
                  <td className="py-1 text-right align-top whitespace-nowrap">
                    {item.quantity}
                  </td>
                  <td className="py-1 text-right align-top whitespace-nowrap">
                    {formatCurrency(item.unit_price_minor, settings)}
                  </td>
                  <td className="py-1 text-right align-top font-semibold whitespace-nowrap">
                    {formatCurrency(item.line_subtotal_minor, settings)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="border-t border-dashed border-slate-400 pt-2 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(sale.subtotal_minor, settings)}</span>
            </div>
            {sale.discount_amount_minor > 0 && (
              <div className="flex justify-between">
                <span>
                  Discount
                  {sale.discount_type === 'percentage'
                    ? ` (${(sale.discount_value / 100).toFixed(1)}%)`
                    : ''}
                </span>
                <span>-{formatCurrency(sale.discount_amount_minor, settings)}</span>
              </div>
            )}
            {sale.tax_amount_minor > 0 && (
              <div className="flex justify-between">
                <span>
                  {settings.tax_label} ({(sale.tax_rate_bps / 100).toFixed(2)}%)
                </span>
                <span>{formatCurrency(sale.tax_amount_minor, settings)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-800 pt-1 text-sm font-bold">
              <span>GRAND TOTAL</span>
              <span>{formatCurrency(sale.total_minor, settings)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="border-t border-dashed border-slate-400 mt-2 pt-2 space-y-0.5 text-[11px]">
            <div className="flex justify-between">
              <span>Payment Method</span>
              <span className="font-semibold">
                {PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Amount Received</span>
              <span>{formatCurrency(sale.paid_minor, settings)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Change Returned</span>
              <span>{formatCurrency(sale.change_minor, settings)}</span>
            </div>
          </div>

          {/* Refunds Summary if any */}
          {sale.refunds && sale.refunds.length > 0 && (
            <div className="border-t border-dashed border-slate-400 mt-2 pt-2 space-y-1 text-[11px]">
              <div className="font-bold uppercase">Refund Records</div>
              {sale.refunds.map((rfd) => (
                <div key={rfd.id} className="flex justify-between">
                  <span>{rfd.refund_number}</span>
                  <span>-{formatCurrency(rfd.total_refund_minor, settings)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-dashed border-slate-400 mt-3 pt-2 text-center text-[10px] text-slate-600">
            <div>{settings.receipt_footer}</div>
            <div className="mt-1 font-semibold">*** END OF RECEIPT ***</div>
          </div>
        </div>
      </div>
    </div>
  );
}
