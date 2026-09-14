import type { CartItem, StoreContext, StoreEvent, StoreProduct } from './types';
import { assign, createMachine } from 'xstate';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../lib/utils';
import { KioskAuditService } from '../services/audit';

// ── Validation ────────────────────────────────────────────────────────────────

function validateCheckout(context: StoreContext): Record<string, string> {
  const errors: Record<string, string> = {};

  // Saved-customer charges pull buyer info from the IQPro vault — we don't
  // need to re-collect name/email/address. Only require the match selection.
  if (context.paymentMethod === 'saved') {
    if (!context.selectedSavedMatchToken) {
      errors.savedPaymentMethod = 'Please look up and select a saved payment method';
    }
    return errors;
  }

  if (!context.firstName?.trim()) {
    errors.firstName = 'First name is required';
  }
  if (!context.lastName?.trim()) {
    errors.lastName = 'Last name is required';
  }
  if (!context.email?.trim()) {
    errors.email = 'Email is required';
  }
  else if (!isValidEmail(context.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (!context.phoneNumber?.trim()) {
    errors.phoneNumber = 'Phone number is required';
  }
  else if (!isValidPhoneNumber(context.phoneNumber)) {
    errors.phoneNumber = 'Please enter a valid 10-digit phone number';
  }
  if (!context.address?.trim()) {
    errors.address = 'Address is required';
  }
  if (!context.city?.trim()) {
    errors.city = 'City is required';
  }
  if (!context.state?.trim()) {
    errors.state = 'State is required';
  }
  if (!context.zip?.trim()) {
    errors.zip = 'ZIP code is required';
  }

  return errors;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

/**
 * Units of `variantId` (or the product as a whole) that may still be bought,
 * or `null` when this item does not track inventory and is effectively
 * unlimited.
 */
export function availableUnits(
  product: StoreProduct | null,
  variantId: string,
): number | null {
  if (!product || !product.trackInventory) {
    return null;
  }
  if (variantId) {
    const variant = product.variants?.find(v => v.id === variantId);
    return Math.max(0, variant?.stockQuantity ?? 0);
  }
  // No variant chosen yet: report the product-wide figure so a fully sold-out
  // product can be blocked before the member picks a size.
  return product.availableStock === null ? null : Math.max(0, product.availableStock);
}

/**
 * Units of a cart line still addable, given what is already in the cart. The
 * cart total matters: adding 3 then 3 more of a 5-in-stock item must fail on
 * the second add, not silently make 6.
 */
function remainingUnits(context: StoreContext, variantId: string): number | null {
  const { selectedProduct, cartItems } = context;
  const stock = availableUnits(selectedProduct, variantId);
  if (stock === null || !selectedProduct) {
    return null;
  }
  const inCart = cartItems
    .filter(item => item.productId === selectedProduct.id && item.variantId === (variantId || undefined))
    .reduce((sum, item) => sum + item.quantity, 0);
  return Math.max(0, stock - inCart);
}

// ── Empty context ─────────────────────────────────────────────────────────────

const emptyContext: StoreContext = {
  products: [],
  isLoadingProducts: false,
  selectedProduct: null,
  selectedVariantId: '',
  selectedQuantity: 1,
  cartItems: [],
  discountCode: '',
  discountAmount: 0,
  feeBreakdown: null,
  isCalculatingFees: false,
  memberSearchPhone: '',
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  country: 'United States',
  address: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  hasSalesAgreement: false,
  paymentMethod: 'card',
  cardholderName: '',
  cardToken: '',
  cardFirstSix: '',
  cardLastFour: '',
  cardExpiry: '',
  achAccountHolder: '',
  achRoutingNumber: '',
  achAccountNumber: '',
  achAccountType: 'Checking',
  savedLookupPhone: '',
  isSearchingSaved: false,
  savedSearchPerformed: false,
  savedMatches: [],
  selectedSavedMatchToken: null,
  selectedSavedFullName: null,
  memberLookupNotFound: false,
  errors: {} as Record<string, string>,
  isSubmitting: false,
  sessionId: '',
};

// ── Guards ────────────────────────────────────────────────────────────────────

const storeGuards = {
  hasItemsInCart: ({ context }: { context: StoreContext }) =>
    context.cartItems.length > 0,

  isCheckoutValid: ({ context }: { context: StoreContext }) =>
    Object.keys(validateCheckout(context)).length === 0,

  hasVariantsAndNoneSelected: ({ context }: { context: StoreContext }) =>
    !!(context.selectedProduct?.variants?.length && !context.selectedVariantId),

  // Sold out: nothing left of this variant (or of the product, before a variant
  // is picked). Ordered BEFORE the happy path so it wins.
  isSelectionOutOfStock: ({ context }: { context: StoreContext }) => {
    const remaining = remainingUnits(context, context.selectedVariantId);
    return remaining !== null && remaining <= 0;
  },

  // More requested than is left on the shelf.
  exceedsAvailableStock: ({ context }: { context: StoreContext }) => {
    const remaining = remainingUnits(context, context.selectedVariantId);
    return remaining !== null && context.selectedQuantity > remaining;
  },
};

// ── Actions ───────────────────────────────────────────────────────────────────

const storeActions = {
  auditOrderPlaced: ({ context }: { context: StoreContext }) => {
    const audit = KioskAuditService.getInstance();
    const subtotal = context.cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    audit.log(
      'payment',
      `order_${Date.now()}`,
      'create',
      { sessionId: context.sessionId, phoneNumber: context.phoneNumber },
      {
        // Non-PII only — name/email/phone are deliberately NOT audited.
        action: 'store_order',
        itemCount: context.cartItems.length,
        subtotal,
      },
    );
  },

  auditTimeout: ({ context }: { context: StoreContext }) => {
    KioskAuditService.getInstance().logSession('timeout', {
      sessionId: context.sessionId,
    });
  },
};

// ── Machine ───────────────────────────────────────────────────────────────────

export const storeMachine = createMachine({
  id: 'store',
  types: {} as { context: StoreContext; events: StoreEvent },

  context: { ...emptyContext },

  initial: 'browsing',

  states: {
    // ── Browse ────────────────────────────────────────────────────────────────
    browsing: {
      entry: assign(({ context }) => ({
        // Start a new session only on first entry (products not yet loaded).
        // Cart items are intentionally NOT reset here so browsing back from a
        // product view doesn't clear the cart. Full reset happens on RESET event.
        sessionId: context.sessionId || generateSessionId(),
        // Only trigger loading when we don't already have products
        isLoadingProducts: context.products.length === 0,
        selectedProduct: null,
        selectedVariantId: '',
        selectedQuantity: 1,
        errors: {} as Record<string, string>,
      })),

      on: {
        LOAD_PRODUCTS_SUCCESS: {
          actions: assign({
            products: ({ event }) => event.products,
            isLoadingProducts: false,
          }),
        },
        LOAD_PRODUCTS_FAILURE: {
          actions: assign({ isLoadingProducts: false }),
        },
        VIEW_PRODUCT: {
          target: 'viewingProduct',
          actions: assign(({ event }) => ({
            selectedProduct: event.product,
            selectedVariantId: event.product.variants?.length === 1 ? event.product.variants[0]!.id : '',
            selectedQuantity: 1,
            errors: {} as Record<string, string>,
          })),
        },
        VIEW_CART: 'viewingCart',
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
        TIMEOUT: 'timeout',
      },
    },

    // ── Product detail ────────────────────────────────────────────────────────
    viewingProduct: {
      on: {
        BACK_TO_BROWSE: 'browsing',
        SELECT_VARIANT: {
          actions: assign(({ event, context }) => {
            const nextErrors = { ...context.errors };
            delete nextErrors.selectedVariantId;
            // A different size may well be in stock; carrying the old sold-out
            // message over would be wrong.
            delete nextErrors.stock;
            // Reset the quantity: the previous variant's stock ceiling has no
            // bearing on this one.
            return { selectedVariantId: event.variantId, selectedQuantity: 1, errors: nextErrors };
          }),
        },
        UPDATE_QUANTITY: {
          // Clamp to what's actually on the shelf (and to the per-order cap) so
          // the stepper cannot be walked past the stock level.
          actions: assign(({ event, context }) => {
            const remaining = remainingUnits(context, context.selectedVariantId);
            const perOrderCap = context.selectedProduct?.maxPerOrder ?? Number.POSITIVE_INFINITY;
            const ceiling = Math.min(
              remaining === null ? Number.POSITIVE_INFINITY : remaining,
              perOrderCap,
            );
            const wanted = Math.max(1, event.quantity);
            return {
              selectedQuantity: Number.isFinite(ceiling) ? Math.min(wanted, Math.max(1, ceiling)) : wanted,
            };
          }),
        },
        ADD_TO_CART: [
          // When product has variants but none is selected: show error, stay
          {
            guard: 'hasVariantsAndNoneSelected',
            actions: assign({
              errors: { selectedVariantId: 'Please select an option' } as Record<string, string>,
            }),
          },
          // Sold out — refuse. This is the control that was missing entirely:
          // the store had no stock concept, so out-of-stock belts and mouth
          // guards went into the cart and all the way through checkout.
          {
            guard: 'isSelectionOutOfStock',
            actions: assign({
              errors: { stock: 'This item is out of stock.' } as Record<string, string>,
            }),
          },
          // Partially available — tell them how many are left instead of
          // quietly trimming the quantity behind their back.
          {
            guard: 'exceedsAvailableStock',
            actions: assign(({ context }) => {
              const remaining = remainingUnits(context, context.selectedVariantId) ?? 0;
              return {
                errors: {
                  stock: remaining === 1
                    ? 'Only 1 left in stock.'
                    : `Only ${remaining} left in stock.`,
                } as Record<string, string>,
              };
            }),
          },
          // Happy path: add/merge item into cart and go to cart
          {
            target: 'viewingCart',
            actions: assign(({ context }) => {
              const { selectedProduct, selectedVariantId, selectedQuantity, cartItems } = context;
              if (!selectedProduct) {
                return {};
              }

              const variant = selectedProduct.variants?.find(v => v.id === selectedVariantId);
              const price = variant ? variant.price : selectedProduct.basePrice;

              const existingIndex = cartItems.findIndex(
                item =>
                  item.productId === selectedProduct.id
                  && item.variantId === (selectedVariantId || undefined),
              );

              let newCartItems: CartItem[];
              if (existingIndex >= 0) {
                newCartItems = cartItems.map((item, i) =>
                  i === existingIndex
                    ? { ...item, quantity: item.quantity + selectedQuantity }
                    : item,
                );
              }
              else {
                newCartItems = [
                  ...cartItems,
                  {
                    productId: selectedProduct.id,
                    productName: selectedProduct.name,
                    variantId: selectedVariantId || undefined,
                    variantName: variant?.name,
                    price,
                    quantity: selectedQuantity,
                  },
                ];
              }

              return {
                cartItems: newCartItems,
                selectedProduct: null,
                errors: {} as Record<string, string>,
              };
            }),
          },
        ],
        VIEW_CART: 'viewingCart',
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
        TIMEOUT: 'timeout',
      },
    },

    // ── Cart ──────────────────────────────────────────────────────────────────
    viewingCart: {
      on: {
        BACK_TO_BROWSE: 'browsing',
        REMOVE_ITEM: {
          actions: assign(({ event, context }) => ({
            cartItems: context.cartItems.filter(
              item => !(item.productId === event.productId && item.variantId === event.variantId),
            ),
          })),
        },
        UPDATE_FIELD: {
          // Used for discount code input. Editing the code clears the previous
          // rejection message — leaving "This discount code has expired" under
          // a freshly-typed code reads as if the new one failed too.
          actions: assign(({ event, context }) => {
            const nextErrors = { ...context.errors };
            if (event.field === 'discountCode') {
              delete nextErrors.discountCode;
            }
            return { ...context, [event.field]: event.value, errors: nextErrors };
          }),
        },
        APPLY_DISCOUNT: 'applyingDiscount',
        PROCEED_TO_CHECKOUT: {
          target: 'checkout',
          guard: 'hasItemsInCart',
        },
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
        TIMEOUT: 'timeout',
      },
    },

    applyingDiscount: {
      entry: assign({ isSubmitting: true }),
      on: {
        DISCOUNT_APPLIED: {
          target: 'viewingCart',
          actions: assign(({ event }) => ({
            isSubmitting: false,
            discountAmount: event.discountAmount,
          })),
        },
        DISCOUNT_FAILED: {
          target: 'viewingCart',
          actions: assign(({ event }) => ({
            isSubmitting: false,
            discountAmount: 0,
            errors: { discountCode: event.error } as Record<string, string>,
          })),
        },
      },
    },

    // ── Checkout ──────────────────────────────────────────────────────────────
    checkout: {
      // ⚠️ Do NOT clear `errors` here. Two paths re-enter this state carrying
      // messages that must survive: validatingCheckout bounces back with its
      // per-field validation, and the fee-calculation failure writes
      // `errors.fees` — the one thing that explains a permanently-disabled
      // "Place order". Wiping on entry erased both. Errors clear per-field on
      // UPDATE_FIELD and wholesale on RESET.
      entry: assign({ isSubmitting: false }),

      on: {
        BACK_TO_CART: 'viewingCart',
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field];
            // Switching payment method clears the saved-method chooser state so
            // a stale selection can't leak across modes.
            if (field === 'paymentMethod') {
              const pm = value as 'card' | 'ach' | 'saved';
              if (pm !== 'saved') {
                return {
                  paymentMethod: pm,
                  savedLookupPhone: '',
                  isSearchingSaved: false,
                  savedSearchPerformed: false,
                  savedMatches: [],
                  selectedSavedMatchToken: null,
                  selectedSavedFullName: null,
                  errors: newErrors,
                };
              }
              return { paymentMethod: pm, errors: newErrors };
            }
            return { ...context, [field as string]: value, errors: newErrors };
          }),
        },
        LOOKUP_MEMBER: 'lookingUpMember',
        SAVED_LOOKUP_START: {
          actions: assign(({ event, context }) => ({
            savedLookupPhone: event.phone,
            isSearchingSaved: true,
            savedSearchPerformed: false,
            savedMatches: [],
            selectedSavedMatchToken: null,
            selectedSavedFullName: null,
            errors: { ...context.errors, savedPaymentMethod: '' } as Record<string, string>,
          })),
        },
        SAVED_LOOKUP_RESULT: {
          actions: assign(({ event, context }) => ({
            isSearchingSaved: false,
            savedSearchPerformed: true,
            savedMatches: event.matches,
            // If we were on the saved-payment tab but the new lookup returned
            // no matches, fall back to card so the user isn't stranded on a
            // tab whose button just disappeared.
            paymentMethod: (event.matches.length === 0 && context.paymentMethod === 'saved')
              ? 'card' as const
              : context.paymentMethod,
            // Re-running the lookup invalidates any prior selection.
            selectedSavedMatchToken: null,
            selectedSavedFullName: null,
          })),
        },
        SAVED_LOOKUP_FAILED: {
          actions: assign(({ context }) => ({
            isSearchingSaved: false,
            savedSearchPerformed: true,
            savedMatches: [],
            errors: { ...context.errors, savedPaymentMethod: 'Lookup failed. Please try again.' } as Record<string, string>,
          })),
        },
        SAVED_MATCH_SELECTED: {
          actions: assign(({ event, context }) => ({
            selectedSavedMatchToken: event.matchToken,
            selectedSavedFullName: event.fullName,
            // Auto-switch the active payment method to 'saved' so the user
            // doesn't have to pick the tab manually after choosing a name.
            paymentMethod: 'saved' as const,
            errors: { ...context.errors, savedPaymentMethod: '' } as Record<string, string>,
          })),
        },
        SAVED_MATCH_CLEARED: {
          actions: assign({
            selectedSavedMatchToken: null,
            selectedSavedFullName: null,
            // Falling back to card so the buyer form re-enables and the
            // user can proceed without a vaulted customer selection.
            paymentMethod: 'card' as const,
          }),
        },
        CALCULATE_FEES_START: {
          // Clear the previous failure as the retry begins — the checkout entry
          // no longer wipes errors wholesale, so a stale
          // "not configured" would otherwise outlive the condition that caused
          // it (e.g. after switching from ACH back to card).
          actions: assign(({ context }) => {
            const nextErrors = { ...context.errors };
            delete nextErrors.fees;
            return { isCalculatingFees: true, feeBreakdown: null, errors: nextErrors };
          }),
        },
        CALCULATE_FEES_SUCCESS: {
          actions: assign(({ event, context }) => {
            const nextErrors = { ...context.errors };
            delete nextErrors.fees;
            return {
              isCalculatingFees: false,
              feeBreakdown: event.feeBreakdown,
              errors: nextErrors,
            };
          }),
        },
        CALCULATE_FEES_FAILURE: {
          actions: assign(({ event, context }) => ({
            isCalculatingFees: false,
            feeBreakdown: null,
            errors: { ...context.errors, fees: event.error } as Record<string, string>,
          })),
        },
        PLACE_ORDER: 'validatingCheckout',
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
        TIMEOUT: 'timeout',
      },
    },

    lookingUpMember: {
      entry: assign({ isSubmitting: true, memberLookupNotFound: false }),
      on: {
        MEMBER_FOUND: {
          target: 'checkout',
          // Prefill everything the member record actually has. The lookup route
          // has always returned email and the default address; the flow threw
          // them away and sent `email: ''`, so a recognised member still had to
          // retype their whole billing address. `??` rather than `||` so a
          // legitimately empty stored field doesn't fall back oddly, and we
          // keep what's already in the box when the record has nothing.
          actions: assign(({ event, context }) => ({
            isSubmitting: false,
            firstName: event.firstName,
            lastName: event.lastName,
            email: event.email || context.email,
            phoneNumber: event.phone,
            address: event.address || context.address,
            addressLine2: event.addressLine2 || context.addressLine2,
            city: event.city || context.city,
            state: event.state || context.state,
            zip: event.zip || context.zip,
            memberLookupNotFound: false,
          })),
        },
        MEMBER_NOT_FOUND: {
          target: 'checkout',
          actions: assign({ isSubmitting: false, memberLookupNotFound: true }),
        },
      },
    },

    validatingCheckout: {
      entry: assign({ isSubmitting: true }),

      always: [
        { target: 'processingOrder', guard: 'isCheckoutValid' },
        {
          target: 'checkout',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateCheckout(context),
          })),
        },
      ],
    },

    // ── Processing ────────────────────────────────────────────────────────────
    processingOrder: {
      // No mock timer — the component calls the payment API and sends
      // PAYMENT_SUCCESS or PAYMENT_FAILED based on the result.
      on: {
        PAYMENT_SUCCESS: 'orderSuccess',
        PAYMENT_FAILED: {
          target: 'orderFailed',
          actions: assign(({ event }) => ({
            errors: { general: (event as { error?: string }).error || 'Payment failed. Please try again.' } as Record<string, string>,
          })),
        },
        TIMEOUT: 'timeout',
      },
      // Safety net if the component's fetch never settles (no PAYMENT_* event).
      after: {
        30000: {
          target: 'orderFailed',
          actions: assign({
            errors: { general: 'Payment timed out. Please try again.' } as Record<string, string>,
          }),
        },
      },
    },

    // ── Terminal states ───────────────────────────────────────────────────────
    orderSuccess: {
      entry: ['auditOrderPlaced'],
      // 65s safety-net fallback — the component drives the visible 60s countdown
      // and calls onComplete() which triggers RESET. This timer only fires if
      // something goes wrong with the component-side countdown.
      after: { 65000: 'browsing' },
      on: {
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
      },
    },

    orderFailed: {
      on: {
        TRY_AGAIN: 'checkout',
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
      },
    },

    timeout: {
      entry: ['auditTimeout'],
      after: { 3000: 'browsing' },
      on: {
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
      },
    },
  },
}).provide({
  guards: storeGuards,
  actions: storeActions,
});
