import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { membershipMachine } from './membershipMachine';
import { storeMachine } from './storeMachine';
import { trialMachine } from './trialMachine';

afterEach(() => {
  vi.useRealTimers();
});

function freezeToday() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 13, 12, 0, 0)); // 2026-09-13 local midday
}

/**
 * These cover the class of defect where a step BLOCKED progress but said
 * nothing: the machine either had no validator, or had one whose messages the
 * UI could never reach because the submit button was disabled.
 */

describe('trialMachine — blocked steps report why', () => {
  it('reports every missing adult contact field instead of silently refusing', () => {
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' });
    actor.send({ type: 'SUBMIT_CONTACT' });

    const { errors } = actor.getSnapshot().context;
    expect(actor.getSnapshot().value).toBe('collectingInfo');
    expect(errors.firstName).toBe('First name is required');
    expect(errors.lastName).toBe('Last name is required');
    expect(errors.email).toBe('Email is required');
    expect(errors.phoneNumber).toBe('Phone number is required');
    expect(errors.dateOfBirth).toBe('Date of birth is required');
    actor.stop();
  });

  it('rejects a future date of birth on the adult step', () => {
    freezeToday();
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' });
    for (const [field, value] of [
      ['firstName', 'Ada'],
      ['lastName', 'Lovelace'],
      ['email', 'ada@example.com'],
      ['phoneNumber', '5551234567'],
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
      ['dateOfBirth', '2026-11-01'], // November, while it is September
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });

    expect(actor.getSnapshot().value).toBe('collectingInfo');
    expect(actor.getSnapshot().context.errors.dateOfBirth)
      .toBe('Date of birth cannot be in the future');
    actor.stop();
  });

  it('rejects a future date of birth for a child', () => {
    freezeToday();
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'youth' });
    for (const [field, value] of [
      ['parentFirstName', 'Ada'],
      ['parentLastName', 'Lovelace'],
      ['parentEmail', 'ada@example.com'],
      ['parentPhone', '5551234567'],
      ['parentAddress', '1 Main St'],
      ['parentCity', 'Springfield'],
      ['parentState', 'IL'],
      ['parentZip', '62701'],
      ['parentDateOfBirth', '1990-01-01'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_YOUTH_PARENT' });
    expect(actor.getSnapshot().value).toBe('collectingYouthChildInfo');

    for (const [field, value] of [
      ['currentChildFirstName', 'Kid'],
      ['currentChildLastName', 'Lovelace'],
      ['currentChildDateOfBirth', '2027-01-01'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_YOUTH_CHILD' });

    expect(actor.getSnapshot().value).toBe('collectingYouthChildInfo');
    expect(actor.getSnapshot().context.errors.currentChildDateOfBirth)
      .toBe('Date of birth cannot be in the future');
    actor.stop();
  });

  it('names the unticked waiver checkbox AND the empty signature', () => {
    freezeToday();
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' });
    for (const [field, value] of [
      ['firstName', 'Ada'],
      ['lastName', 'Lovelace'],
      ['email', 'ada@example.com'],
      ['phoneNumber', '5551234567'],
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
      ['dateOfBirth', '1990-01-01'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });
    expect(actor.getSnapshot().value).toBe('collectingWaiver');

    actor.send({ type: 'SUBMIT_WAIVER' });

    const { errors } = actor.getSnapshot().context;
    expect(actor.getSnapshot().value).toBe('collectingWaiver');
    expect(errors.waiverAgreed).toBe('You must agree to the waiver to continue');
    expect(errors.signature).toBe('Signature is required');
    actor.stop();
  });

  it('reports only the signature when the box IS ticked', () => {
    freezeToday();
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' });
    for (const [field, value] of [
      ['firstName', 'Ada'],
      ['lastName', 'Lovelace'],
      ['email', 'ada@example.com'],
      ['phoneNumber', '5551234567'],
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
      ['dateOfBirth', '1990-01-01'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });
    actor.send({ type: 'AGREE_WAIVER', agreed: true });
    actor.send({ type: 'SUBMIT_WAIVER' });

    const { errors } = actor.getSnapshot().context;
    expect(errors.waiverAgreed).toBeUndefined();
    expect(errors.signature).toBe('Signature is required');
    actor.stop();
  });

  it('clears a field error as soon as that field is edited', () => {
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' });
    actor.send({ type: 'SUBMIT_CONTACT' });
    expect(actor.getSnapshot().context.errors.firstName).toBeDefined();

    actor.send({ type: 'UPDATE_FIELD', field: 'firstName', value: 'Ada' });

    expect(actor.getSnapshot().context.errors.firstName).toBeUndefined();
    // The other fields' errors must survive — only the edited one clears.
    expect(actor.getSnapshot().context.errors.lastName).toBeDefined();
    actor.stop();
  });

  it('resets to the age step on TIMEOUT, discarding entered personal data', () => {
    const actor = createActor(trialMachine).start();
    actor.send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' });
    actor.send({ type: 'UPDATE_FIELD', field: 'firstName', value: 'Ada' });
    actor.send({ type: 'UPDATE_FIELD', field: 'phoneNumber', value: '5551234567' });

    actor.send({ type: 'TIMEOUT' });
    expect(actor.getSnapshot().value).toBe('timeout');

    actor.send({ type: 'RESET' });
    const ctx = actor.getSnapshot().context;
    expect(actor.getSnapshot().value).toBe('selectingAge');
    // Nothing the previous person typed may survive into the next session.
    expect(ctx.firstName).toBe('');
    expect(ctx.phoneNumber).toBe('');
    expect(ctx.ageGroup).toBeNull();
    actor.stop();
  });
});

describe('membershipMachine — commitment step reports why', () => {
  function atCommitment() {
    freezeToday();
    const actor = createActor(membershipMachine).start();
    actor.send({
      type: 'SELECT_PROGRAM',
      program: { id: 'prog-1', name: 'Adult BJJ', description: '', price: 150, isActive: true },
    });
    actor.send({
      type: 'SELECT_PLAN',
      plan: {
        id: 'plan-1',
        name: 'Monthly',
        description: 'Unlimited classes',
        price: 150,
        interval: 'monthly',
        isActive: true,
      },
    });
    actor.send({ type: 'SUBMIT_PAYMENT' });
    return actor;
  }

  it('names the unticked agreement and the missing signature', () => {
    const actor = atCommitment();
    for (const [field, value] of [
      ['firstName', 'Ada'],
      ['lastName', 'Lovelace'],
      ['email', 'ada@example.com'],
      ['phoneNumber', '5551234567'],
      ['dateOfBirth', '1990-01-01'],
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });
    expect(actor.getSnapshot().value).toBe('reviewingCommitment');

    // Previously this event was swallowed by a bare guard: no transition, no
    // errors, nothing on screen.
    actor.send({ type: 'SUBMIT_COMMITMENT' });

    const { errors } = actor.getSnapshot().context;
    expect(actor.getSnapshot().value).toBe('reviewingCommitment');
    expect(errors.hasAgreedToCommitment).toBe('You must agree to the terms to continue');
    expect(errors.waiverSignature).toBe('Signature is required');
    actor.stop();
  });

  it('requires guardian details for a minor', () => {
    const actor = atCommitment();
    for (const [field, value] of [
      ['firstName', 'Kid'],
      ['lastName', 'Lovelace'],
      ['email', 'kid@example.com'],
      ['phoneNumber', '5551234567'],
      ['dateOfBirth', '2015-01-01'], // 11 years old at the frozen date
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });
    actor.send({ type: 'UPDATE_FIELD', field: 'hasAgreedToCommitment', value: true });
    actor.send({ type: 'UPDATE_FIELD', field: 'waiverSignature', value: 'data:image/png;base64,AAA' });
    actor.send({ type: 'SUBMIT_COMMITMENT' });

    const { errors } = actor.getSnapshot().context;
    expect(actor.getSnapshot().value).toBe('reviewingCommitment');
    expect(errors.guardianFirstName).toBe('Parent/guardian first name is required');
    expect(errors.guardianEmail).toBe('Parent/guardian email is required');
    actor.stop();
  });

  it('does NOT require guardian details for an adult', () => {
    const actor = atCommitment();
    for (const [field, value] of [
      ['firstName', 'Ada'],
      ['lastName', 'Lovelace'],
      ['email', 'ada@example.com'],
      ['phoneNumber', '5551234567'],
      ['dateOfBirth', '1990-01-01'],
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });
    actor.send({ type: 'UPDATE_FIELD', field: 'hasAgreedToCommitment', value: true });
    actor.send({ type: 'UPDATE_FIELD', field: 'waiverSignature', value: 'data:image/png;base64,AAA' });
    actor.send({ type: 'SUBMIT_COMMITMENT' });

    // Passes through to payment — the guardian block is minor-only.
    expect(actor.getSnapshot().value).toBe('collectingPayment');
    actor.stop();
  });

  it('rejects a future date of birth on the contact step', () => {
    const actor = atCommitment();
    for (const [field, value] of [
      ['firstName', 'Ada'],
      ['lastName', 'Lovelace'],
      ['email', 'ada@example.com'],
      ['phoneNumber', '5551234567'],
      ['dateOfBirth', '2026-11-01'],
      ['address', '1 Main St'],
      ['city', 'Springfield'],
      ['state', 'IL'],
      ['zip', '62701'],
    ] as const) {
      actor.send({ type: 'UPDATE_FIELD', field, value });
    }
    actor.send({ type: 'SUBMIT_CONTACT' });

    expect(actor.getSnapshot().value).toBe('collectingInfo');
    expect(actor.getSnapshot().context.errors.dateOfBirth)
      .toBe('Date of birth cannot be in the future');
    actor.stop();
  });
});

describe('storeMachine — checkout errors survive long enough to be read', () => {
  function withCartItem() {
    const actor = createActor(storeMachine).start();
    actor.send({
      type: 'LOAD_PRODUCTS_SUCCESS',
      products: [{
        id: 'p1',
        name: 'Gi',
        description: '',
        images: [],
        basePrice: 120,
        trackInventory: false,
        maxPerOrder: 10,
        availableStock: null,
      }],
    });
    actor.send({ type: 'VIEW_PRODUCT', product: actor.getSnapshot().context.products[0]! });
    actor.send({ type: 'ADD_TO_CART' });
    actor.send({ type: 'PROCEED_TO_CHECKOUT' });
    return actor;
  }

  it('reports missing buyer fields instead of bouncing back silently', () => {
    const actor = withCartItem();
    expect(actor.getSnapshot().value).toBe('checkout');

    actor.send({ type: 'PLACE_ORDER' });

    const { errors } = actor.getSnapshot().context;
    // Back on checkout, WITH the messages intact. The `checkout` entry used to
    // clear `errors`, wiping what validatingCheckout had just written.
    expect(actor.getSnapshot().value).toBe('checkout');
    expect(errors.firstName).toBe('First name is required');
    expect(errors.email).toBe('Email is required');
    expect(errors.zip).toBe('ZIP code is required');
    actor.stop();
  });

  it('keeps a fee-calculation failure on screen — it explains the dead button', () => {
    const actor = withCartItem();
    actor.send({ type: 'CALCULATE_FEES_START' });
    actor.send({ type: 'CALCULATE_FEES_FAILURE', error: 'Payment processing is not configured' });

    expect(actor.getSnapshot().context.errors.fees).toBe('Payment processing is not configured');
    expect(actor.getSnapshot().context.feeBreakdown).toBeNull();
    actor.stop();
  });

  it('clears the stale fee failure when a new calculation starts', () => {
    const actor = withCartItem();
    actor.send({ type: 'CALCULATE_FEES_START' });
    actor.send({ type: 'CALCULATE_FEES_FAILURE', error: 'No ach processor configured on gateway' });
    expect(actor.getSnapshot().context.errors.fees).toBeDefined();

    // Switching back to card re-runs the calc; the ACH message must not linger.
    actor.send({ type: 'CALCULATE_FEES_START' });

    expect(actor.getSnapshot().context.errors.fees).toBeUndefined();
    actor.stop();
  });

  it('refuses to add a sold-out item to the cart', () => {
    const actor = createActor(storeMachine).start();
    const soldOut = {
      id: 'p-belt',
      name: 'Brown Belt',
      description: '',
      images: [],
      basePrice: 29.99,
      trackInventory: true,
      maxPerOrder: 10,
      availableStock: 0,
    };
    actor.send({ type: 'LOAD_PRODUCTS_SUCCESS', products: [soldOut] });
    actor.send({ type: 'VIEW_PRODUCT', product: soldOut });
    actor.send({ type: 'ADD_TO_CART' });

    // Stays on the product page, cart untouched, and SAYS why.
    expect(actor.getSnapshot().value).toBe('viewingProduct');
    expect(actor.getSnapshot().context.cartItems).toHaveLength(0);
    expect(actor.getSnapshot().context.errors.stock).toBe('This item is out of stock.');
    actor.stop();
  });

  it('refuses a quantity beyond the remaining stock and names the number left', () => {
    const actor = createActor(storeMachine).start();
    const limited = {
      id: 'p-guard',
      name: 'Mouth Guard',
      description: '',
      images: [],
      basePrice: 14.99,
      trackInventory: true,
      maxPerOrder: 10,
      availableStock: 2,
      variants: [{ id: 'v1', name: 'Standard', price: 14.99, stockQuantity: 2 }],
    };
    actor.send({ type: 'LOAD_PRODUCTS_SUCCESS', products: [limited] });
    actor.send({ type: 'VIEW_PRODUCT', product: limited });
    // Single-variant products auto-select, so the stock ceiling applies.
    actor.send({ type: 'UPDATE_QUANTITY', quantity: 5 });

    // The stepper clamps rather than letting the request exceed the shelf.
    expect(actor.getSnapshot().context.selectedQuantity).toBe(2);

    actor.send({ type: 'ADD_TO_CART' });
    expect(actor.getSnapshot().context.cartItems[0]?.quantity).toBe(2);
    actor.stop();
  });

  it('counts what is already in the cart against the remaining stock', () => {
    const actor = createActor(storeMachine).start();
    const limited = {
      id: 'p-guard',
      name: 'Mouth Guard',
      description: '',
      images: [],
      basePrice: 14.99,
      trackInventory: true,
      maxPerOrder: 10,
      availableStock: 2,
      variants: [{ id: 'v1', name: 'Standard', price: 14.99, stockQuantity: 2 }],
    };
    actor.send({ type: 'LOAD_PRODUCTS_SUCCESS', products: [limited] });
    actor.send({ type: 'VIEW_PRODUCT', product: limited });
    actor.send({ type: 'ADD_TO_CART' }); // 1 of 2
    expect(actor.getSnapshot().context.cartItems[0]?.quantity).toBe(1);

    // Go back for more. One unit remains, so a second add is fine...
    // (ADD_TO_CART lands on viewingCart, so route back through browsing.)
    actor.send({ type: 'BACK_TO_BROWSE' });
    actor.send({ type: 'VIEW_PRODUCT', product: limited });
    actor.send({ type: 'ADD_TO_CART' });
    expect(actor.getSnapshot().context.cartItems[0]?.quantity).toBe(2);

    // ...and a third must be refused — the shelf is empty now.
    actor.send({ type: 'BACK_TO_BROWSE' });
    actor.send({ type: 'VIEW_PRODUCT', product: limited });
    actor.send({ type: 'ADD_TO_CART' });
    expect(actor.getSnapshot().context.cartItems[0]?.quantity).toBe(2);
    expect(actor.getSnapshot().context.errors.stock).toBe('This item is out of stock.');
    actor.stop();
  });

  it('does not limit an item that does not track inventory', () => {
    const actor = createActor(storeMachine).start();
    const unlimited = {
      id: 'p1',
      name: 'Gi',
      description: '',
      images: [],
      basePrice: 120,
      trackInventory: false,
      maxPerOrder: 99,
      availableStock: null,
    };
    actor.send({ type: 'LOAD_PRODUCTS_SUCCESS', products: [unlimited] });
    actor.send({ type: 'VIEW_PRODUCT', product: unlimited });
    actor.send({ type: 'UPDATE_QUANTITY', quantity: 9 });

    // No stock ceiling, and 9 is under the per-order cap, so nothing clamps.
    expect(actor.getSnapshot().context.selectedQuantity).toBe(9);
    actor.stop();
  });

  it('still honours maxPerOrder on an untracked item', () => {
    const actor = createActor(storeMachine).start();
    const capped = {
      id: 'p1',
      name: 'Gi',
      description: '',
      images: [],
      basePrice: 120,
      trackInventory: false,
      maxPerOrder: 3,
      availableStock: null,
    };
    actor.send({ type: 'LOAD_PRODUCTS_SUCCESS', products: [capped] });
    actor.send({ type: 'VIEW_PRODUCT', product: capped });
    actor.send({ type: 'UPDATE_QUANTITY', quantity: 10 });

    expect(actor.getSnapshot().context.selectedQuantity).toBe(3);
    actor.stop();
  });
});
