import { describe, expect, it } from 'vitest';
import {
  calculateBpsAmount,
  calculateSaleTotals,
  formatMoney,
  toMajorUnits,
  toMinorUnits,
} from '../shared/money.ts';

describe('Fixed-Precision Integer Money Utilities', () => {
  it('converts major and minor currency units accurately without float drift', () => {
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(295.5)).toBe(29550);
    expect(toMajorUnits(29550)).toBe(295.5);
  });

  it('formats PKR currency cleanly', () => {
    expect(formatMoney(150000)).toBe('Rs. 1,500.00');
    expect(formatMoney(-2500)).toBe('-Rs. 25.00');
  });

  it('calculates basis points accurately', () => {
    expect(calculateBpsAmount(100000, 1700)).toBe(17000); // 17% of 1000.00 = 170.00
    expect(calculateBpsAmount(3333, 500)).toBe(167); // 5% of 33.33 = 1.6665 -> 1.67
  });

  it('calculates sale totals with percentage discount and exclusive tax', () => {
    const res = calculateSaleTotals({
      items: [
        { unitPriceMinor: 10000, quantity: 2 }, // 200.00
        { unitPriceMinor: 5000, quantity: 1 },  // 50.00 -> subtotal 250.00
      ],
      discountType: 'percentage',
      discountValue: 1000, // 10% -> 25.00 discount -> net 225.00
      taxRateBps: 1600, // 16% -> 36.00 tax
      taxInclusive: false,
    });

    expect(res.subtotalMinor).toBe(25000);
    expect(res.discountAmountMinor).toBe(2500);
    expect(res.taxableAmountMinor).toBe(22500);
    expect(res.taxAmountMinor).toBe(3600);
    expect(res.totalMinor).toBe(26100);
    expect(res.totalQuantity).toBe(3);
  });

  it('calculates tax-inclusive totals correctly', () => {
    const res = calculateSaleTotals({
      items: [{ unitPriceMinor: 11600, quantity: 1 }], // 116.00 inclusive of 16% tax
      discountType: 'none',
      discountValue: 0,
      taxRateBps: 1600,
      taxInclusive: true,
    });

    expect(res.totalMinor).toBe(11600);
    expect(res.taxableAmountMinor).toBe(10000);
    expect(res.taxAmountMinor).toBe(1600);
  });

  it('clamps fixed discount so it never exceeds subtotal', () => {
    const res = calculateSaleTotals({
      items: [{ unitPriceMinor: 5000, quantity: 1 }],
      discountType: 'fixed',
      discountValue: 99999,
      taxRateBps: 1000,
      taxInclusive: false,
    });

    expect(res.discountAmountMinor).toBe(5000);
    expect(res.taxAmountMinor).toBe(0);
    expect(res.totalMinor).toBe(0);
  });
});
