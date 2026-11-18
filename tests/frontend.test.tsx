/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReceiptView } from '../src/components/ReceiptView.tsx';
import { usePosStore } from '../src/stores/posStore.ts';
import type { AppSettings, ProductDTO, SaleDTO } from '../shared/types.ts';

const MOCK_SETTINGS: AppSettings = {
  shop_name: 'Al-Madina Fresh Supermarket',
  shop_address: 'Gulberg III, Lahore',
  shop_phone: '+92 42 35761920',
  shop_tax_id: 'NTN-4189204-7',
  currency_code: 'PKR',
  currency_symbol: 'Rs.',
  tax_rate_bps: 1600,
  tax_inclusive: false,
  tax_label: 'GST',
  receipt_header: 'Quality Groceries',
  receipt_footer: 'Thank you for shopping with us!',
  receipt_paper_width: '80mm',
  default_payment_method: 'cash',
  allow_negative_inventory: false,
  default_cashier_name: 'Counter 1',
};

const MOCK_SALE: SaleDTO = {
  id: 1,
  receipt_number: 'INV-20261117-0001',
  idempotency_key: 'abc',
  customer_id: null,
  customer_name: null,
  customer_phone: null,
  cashier_name: 'Counter 1',
  subtotal_minor: 50000,
  discount_type: 'fixed',
  discount_value: 5000,
  discount_amount_minor: 5000,
  tax_rate_bps: 1600,
  tax_amount_minor: 7200,
  total_minor: 52200,
  paid_minor: 60000,
  change_minor: 7800,
  payment_method: 'cash',
  status: 'completed',
  notes: '',
  created_at: '2026-11-17 10:00:00',
  items: [
    {
      id: 1,
      sale_id: 1,
      product_id: 1,
      product_name: 'Olpers Milk 1L',
      barcode: '8961003021015',
      sku: 'DAI-1001',
      unit: 'L',
      quantity: 2,
      unit_price_minor: 25000,
      purchase_price_minor: 22000,
      line_subtotal_minor: 50000,
      refunded_qty: 0,
    },
  ],
};

describe('Frontend POS Store & Receipt Component', () => {
  beforeEach(() => {
    usePosStore.getState().clearCart();
  });

  it('renders printable receipt with shop info, items, discount, tax, and change due', () => {
    render(<ReceiptView sale={MOCK_SALE} settings={MOCK_SETTINGS} />);

    expect(screen.getByText('Al-Madina Fresh Supermarket')).toBeInTheDocument();
    expect(screen.getByText('INV-20261117-0001')).toBeInTheDocument();
    expect(screen.getByText('Olpers Milk 1L')).toBeInTheDocument();
    expect(screen.getByText('Rs. 522.00')).toBeInTheDocument();
    expect(screen.getByText('Rs. 78.00')).toBeInTheDocument();
    expect(screen.getByText('Thank you for shopping with us!')).toBeInTheDocument();

    // Switch receipt format between 80mm and 58mm
    fireEvent.click(screen.getByText('58mm Thermal'));
    expect(document.getElementById('printable-receipt')).toHaveClass('receipt-paper-58mm');
  });

  it('manages POS cart additions, quantity updates, and hold/resume workflow', () => {
    const sampleProduct: ProductDTO = {
      id: 1,
      name: 'Tapal Tea 450g',
      barcode: '8961002014502',
      sku: 'BEV-3001',
      category_id: 1,
      category_name: 'Beverages',
      purchase_price_minor: 68000,
      selling_price_minor: 76000,
      stock_qty: 20,
      min_stock_threshold: 5,
      unit: 'pack',
      description: '',
      is_active: 1,
      created_at: '',
      updated_at: '',
    };

    const store = usePosStore.getState();
    store.addItem(sampleProduct, 2);
    expect(usePosStore.getState().items).toHaveLength(1);
    expect(usePosStore.getState().items[0].quantity).toBe(2);

    usePosStore.getState().updateItemQty(1, 5);
    expect(usePosStore.getState().items[0].quantity).toBe(5);

    usePosStore.getState().holdCurrentCart('Customer #1');
    expect(usePosStore.getState().items).toHaveLength(0);
    expect(usePosStore.getState().heldCarts).toHaveLength(1);

    const heldId = usePosStore.getState().heldCarts[0].id;
    usePosStore.getState().resumeHeldCart(heldId);
    expect(usePosStore.getState().items).toHaveLength(1);
    expect(usePosStore.getState().items[0].quantity).toBe(5);
  });
});
