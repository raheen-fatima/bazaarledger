/**
 * Fixed-precision integer money utilities.
 * All financial values are stored and calculated in minor currency units
 * (e.g., paisa for PKR, cents for USD: 100 minor units = 1 major unit).
 */

export interface CurrencyConfig {
  code: string;
  symbol: string;
  minorUnitsPerMajor: number;
}

export const DEFAULT_CURRENCY: CurrencyConfig = {
  code: 'PKR',
  symbol: 'Rs.',
  minorUnitsPerMajor: 100,
};

export const CURRENCY_PRESETS: Record<string, CurrencyConfig> = {
  PKR: { code: 'PKR', symbol: 'Rs.', minorUnitsPerMajor: 100 },
  USD: { code: 'USD', symbol: '$', minorUnitsPerMajor: 100 },
  EUR: { code: 'EUR', symbol: '€', minorUnitsPerMajor: 100 },
  GBP: { code: 'GBP', symbol: '£', minorUnitsPerMajor: 100 },
  AED: { code: 'AED', symbol: 'AED', minorUnitsPerMajor: 100 },
  SAR: { code: 'SAR', symbol: 'SAR', minorUnitsPerMajor: 100 },
  INR: { code: 'INR', symbol: '₹', minorUnitsPerMajor: 100 },
};

/**
 * Converts a major unit number (e.g., 125.50) into integer minor units (12550).
 */
export function toMinorUnits(majorAmount: number, minorPerMajor = 100): number {
  if (!Number.isFinite(majorAmount)) {
    throw new Error('Invalid monetary amount');
  }
  return Math.round(majorAmount * minorPerMajor);
}

/**
 * Converts integer minor units (e.g., 12550) to major decimal number (125.5).
 */
export function toMajorUnits(minorAmount: number, minorPerMajor = 100): number {
  return minorAmount / minorPerMajor;
}

/**
 * Formats integer minor units for UI and receipts.
 */
export function formatMoney(
  minorAmount: number,
  currency: CurrencyConfig = DEFAULT_CURRENCY,
  options?: { showDecimals?: boolean; includeSymbol?: boolean }
): string {
  const showDecimals = options?.showDecimals ?? true;
  const includeSymbol = options?.includeSymbol ?? true;
  const isNegative = minorAmount < 0;
  const absMinor = Math.abs(Math.round(minorAmount));
  const major = absMinor / currency.minorUnitsPerMajor;

  const formattedNumber = major.toLocaleString('en-US', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });

  const prefix = isNegative ? '-' : '';
  return includeSymbol
    ? `${prefix}${currency.symbol} ${formattedNumber}`
    : `${prefix}${formattedNumber}`;
}

/**
 * Calculates percentage using basis points (100 bps = 1%, 10000 bps = 100%).
 * Uses integer rounding half-up.
 */
export function calculateBpsAmount(baseMinor: number, rateBps: number): number {
  if (rateBps <= 0 || baseMinor <= 0) return 0;
  return Math.round((baseMinor * rateBps) / 10000);
}

export interface SaleTotalsInput {
  items: Array<{ unitPriceMinor: number; quantity: number }>;
  discountType: 'none' | 'fixed' | 'percentage';
  discountValue: number; // minor units if fixed, basis points (e.g. 1000 = 10%) if percentage
  taxRateBps: number; // e.g. 1600 = 16%
  taxInclusive: boolean;
}

export interface SaleTotalsResult {
  subtotalMinor: number;
  discountAmountMinor: number;
  taxableAmountMinor: number;
  taxAmountMinor: number;
  totalMinor: number;
  totalQuantity: number;
}

/**
 * Authoritative financial calculation for POS cart and backend checkout.
 * Uses pure integer math in minor units.
 */
export function calculateSaleTotals(input: SaleTotalsInput): SaleTotalsResult {
  let subtotalMinor = 0;
  let totalQuantity = 0;

  for (const item of input.items) {
    const qty = Math.max(0, Math.floor(item.quantity));
    const unitPrice = Math.max(0, Math.round(item.unitPriceMinor));
    subtotalMinor += unitPrice * qty;
    totalQuantity += qty;
  }

  let discountAmountMinor = 0;
  if (input.discountType === 'fixed') {
    discountAmountMinor = Math.min(subtotalMinor, Math.max(0, Math.round(input.discountValue)));
  } else if (input.discountType === 'percentage') {
    const clampedBps = Math.min(10000, Math.max(0, Math.round(input.discountValue)));
    discountAmountMinor = calculateBpsAmount(subtotalMinor, clampedBps);
  }

  const netAfterDiscount = Math.max(0, subtotalMinor - discountAmountMinor);

  let taxAmountMinor = 0;
  let taxableAmountMinor = netAfterDiscount;
  let totalMinor = netAfterDiscount;

  if (input.taxRateBps > 0 && netAfterDiscount > 0) {
    if (input.taxInclusive) {
      // Total already includes tax: tax = net - round(net * 10000 / (10000 + rateBps))
      taxableAmountMinor = Math.round((netAfterDiscount * 10000) / (10000 + input.taxRateBps));
      taxAmountMinor = netAfterDiscount - taxableAmountMinor;
      totalMinor = netAfterDiscount;
    } else {
      taxAmountMinor = calculateBpsAmount(netAfterDiscount, input.taxRateBps);
      totalMinor = netAfterDiscount + taxAmountMinor;
    }
  }

  return {
    subtotalMinor,
    discountAmountMinor,
    taxableAmountMinor,
    taxAmountMinor,
    totalMinor,
    totalQuantity,
  };
}
