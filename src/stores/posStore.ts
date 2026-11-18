import { create } from 'zustand';
import type { DiscountType, PaymentMethod, ProductDTO } from '../../shared/types.ts';

export interface CartItem {
  product_id: number;
  name: string;
  barcode: string;
  sku: string;
  unit: string;
  unit_price_minor: number;
  stock_qty: number;
  quantity: number;
}

export interface HeldCart {
  id: string;
  label: string;
  createdAt: string;
  items: CartItem[];
  customerId: number | null;
  discountType: DiscountType;
  discountInput: number;
  notes: string;
}

interface PosState {
  items: CartItem[];
  customerId: number | null;
  discountType: DiscountType;
  discountInput: number; // major currency if fixed, percentage 0-100 if percentage
  paymentMethod: PaymentMethod;
  paidMajorInput: number | null;
  paymentReference: string;
  notes: string;
  idempotencyKey: string;
  heldCarts: HeldCart[];

  addItem: (product: ProductDTO, qty?: number) => void;
  updateItemQty: (productId: number, quantity: number) => void;
  removeItem: (productId: number) => void;
  setCustomerId: (customerId: number | null) => void;
  setDiscount: (type: DiscountType, value: number) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setPaidMajorInput: (amount: number | null) => void;
  setPaymentReference: (ref: string) => void;
  setNotes: (notes: string) => void;
  holdCurrentCart: (label?: string) => void;
  resumeHeldCart: (heldId: string) => void;
  deleteHeldCart: (heldId: string) => void;
  clearCart: () => void;
  refreshIdempotencyKey: () => void;
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const usePosStore = create<PosState>((set, get) => ({
  items: [],
  customerId: null,
  discountType: 'none',
  discountInput: 0,
  paymentMethod: 'cash',
  paidMajorInput: null,
  paymentReference: '',
  notes: '',
  idempotencyKey: makeIdempotencyKey(),
  heldCarts: [],

  addItem: (product, qty = 1) =>
    set((state) => {
      const existing = state.items.find((i) => i.product_id === product.id);
      const nextItems = existing
        ? state.items.map((i) =>
            i.product_id === product.id
              ? { ...i, quantity: i.quantity + qty, stock_qty: product.stock_qty }
              : i
          )
        : [
            ...state.items,
            {
              product_id: product.id,
              name: product.name,
              barcode: product.barcode,
              sku: product.sku,
              unit: product.unit,
              unit_price_minor: product.selling_price_minor,
              stock_qty: product.stock_qty,
              quantity: qty,
            },
          ];
      return {
        items: nextItems,
        idempotencyKey: makeIdempotencyKey(),
      };
    }),

  updateItemQty: (productId, quantity) =>
    set((state) => {
      if (quantity <= 0) {
        return {
          items: state.items.filter((i) => i.product_id !== productId),
          idempotencyKey: makeIdempotencyKey(),
        };
      }
      return {
        items: state.items.map((i) =>
          i.product_id === productId ? { ...i, quantity: Math.floor(quantity) } : i
        ),
        idempotencyKey: makeIdempotencyKey(),
      };
    }),

  removeItem: (productId) =>
    set((state) => ({
      items: state.items.filter((i) => i.product_id !== productId),
      idempotencyKey: makeIdempotencyKey(),
    })),

  setCustomerId: (customerId) => set({ customerId }),
  setDiscount: (discountType, discountInput) =>
    set({ discountType, discountInput: Math.max(0, discountInput) }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setPaidMajorInput: (paidMajorInput) => set({ paidMajorInput }),
  setPaymentReference: (paymentReference) => set({ paymentReference }),
  setNotes: (notes) => set({ notes }),

  holdCurrentCart: (label) => {
    const state = get();
    if (state.items.length === 0) return;
    const held: HeldCart = {
      id: `hold-${Date.now()}`,
      label: label || `Hold #${state.heldCarts.length + 1} (${state.items.length} items)`,
      createdAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      items: state.items,
      customerId: state.customerId,
      discountType: state.discountType,
      discountInput: state.discountInput,
      notes: state.notes,
    };
    set({
      heldCarts: [held, ...state.heldCarts],
      items: [],
      customerId: null,
      discountType: 'none',
      discountInput: 0,
      paidMajorInput: null,
      paymentReference: '',
      notes: '',
      idempotencyKey: makeIdempotencyKey(),
    });
  },

  resumeHeldCart: (heldId) => {
    const state = get();
    const target = state.heldCarts.find((h) => h.id === heldId);
    if (!target) return;
    set({
      items: target.items,
      customerId: target.customerId,
      discountType: target.discountType,
      discountInput: target.discountInput,
      notes: target.notes,
      paidMajorInput: null,
      paymentReference: '',
      heldCarts: state.heldCarts.filter((h) => h.id !== heldId),
      idempotencyKey: makeIdempotencyKey(),
    });
  },

  deleteHeldCart: (heldId) =>
    set((state) => ({
      heldCarts: state.heldCarts.filter((h) => h.id !== heldId),
    })),

  clearCart: () =>
    set({
      items: [],
      customerId: null,
      discountType: 'none',
      discountInput: 0,
      paidMajorInput: null,
      paymentReference: '',
      notes: '',
      idempotencyKey: makeIdempotencyKey(),
    }),

  refreshIdempotencyKey: () => set({ idempotencyKey: makeIdempotencyKey() }),
}));
