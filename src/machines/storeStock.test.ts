import type { StoreProduct } from './types';
import { describe, expect, it } from 'vitest';
import { availableUnits } from './storeMachine';

function product(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: 'p1',
    name: 'Brown Belt',
    description: '',
    images: [],
    basePrice: 29.99,
    trackInventory: true,
    maxPerOrder: 10,
    availableStock: 0,
    ...overrides,
  };
}

describe('availableUnits', () => {
  it('reports null for an untracked product — it is effectively unlimited', () => {
    const p = product({ trackInventory: false, availableStock: null });
    expect(availableUnits(p, '')).toBeNull();
  });

  it('reports null when there is no selected product', () => {
    expect(availableUnits(null, 'v1')).toBeNull();
  });

  it('reports 0 for a fully sold-out product before a variant is picked', () => {
    // The reported defect: Brown Belt / Black Belt / Mouth Guard were all
    // supposed to be out of stock and the store let people buy several.
    expect(availableUnits(product({ availableStock: 0 }), '')).toBe(0);
  });

  it('reports the product-wide total before a variant is picked', () => {
    const p = product({
      availableStock: 7,
      variants: [
        { id: 'v1', name: 'Small', price: 29.99, stockQuantity: 3 },
        { id: 'v2', name: 'Large', price: 29.99, stockQuantity: 4 },
      ],
    });
    expect(availableUnits(p, '')).toBe(7);
  });

  it('reports the chosen variant stock once a variant is picked', () => {
    const p = product({
      availableStock: 7,
      variants: [
        { id: 'v1', name: 'Small', price: 29.99, stockQuantity: 3 },
        { id: 'v2', name: 'Large', price: 29.99, stockQuantity: 4 },
      ],
    });
    expect(availableUnits(p, 'v1')).toBe(3);
    expect(availableUnits(p, 'v2')).toBe(4);
  });

  it('reports 0 for a sold-out variant of an otherwise in-stock product', () => {
    const p = product({
      availableStock: 4,
      variants: [
        { id: 'v1', name: 'Small', price: 29.99, stockQuantity: 0 },
        { id: 'v2', name: 'Large', price: 29.99, stockQuantity: 4 },
      ],
    });
    expect(availableUnits(p, 'v1')).toBe(0);
  });

  it('treats an unknown variant id as sold out rather than unlimited', () => {
    const p = product({
      availableStock: 4,
      variants: [{ id: 'v2', name: 'Large', price: 29.99, stockQuantity: 4 }],
    });
    expect(availableUnits(p, 'does-not-exist')).toBe(0);
  });

  it('clamps a negative stored stock to 0', () => {
    const p = product({
      availableStock: -3,
      variants: [{ id: 'v1', name: 'Small', price: 29.99, stockQuantity: -3 }],
    });
    expect(availableUnits(p, 'v1')).toBe(0);
    expect(availableUnits(p, '')).toBe(0);
  });

  it('treats a null variant stock on a TRACKED product as 0, not unlimited', () => {
    // Fail closed: a missing count on a tracked item must not open the floodgates.
    const p = product({
      availableStock: 0,
      variants: [{ id: 'v1', name: 'Small', price: 29.99, stockQuantity: null }],
    });
    expect(availableUnits(p, 'v1')).toBe(0);
  });
});
