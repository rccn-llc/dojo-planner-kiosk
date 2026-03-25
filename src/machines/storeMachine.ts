import type { CartItem, StoreContext, StoreEvent } from './types';
import { assign, createMachine } from 'xstate';
import { KioskAuditService } from '../services/audit';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../shared/utils';

// ── Validation ────────────────────────────────────────────────────────────────

function validateCheckout(context: StoreContext): Record<string, string> {
  const errors: Record<string, string> = {};

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
  adminFeeRate: 0.0475,
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
        action: 'store_order',
        itemCount: context.cartItems.length,
        subtotal,
        firstName: context.firstName,
        email: context.email,
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
          actions: assign(({ event, context }) => ({
            selectedVariantId: event.variantId,
            errors: { ...context.errors, selectedVariantId: '' },
          })),
        },
        UPDATE_QUANTITY: {
          actions: assign({
            selectedQuantity: ({ event }) => Math.max(1, event.quantity),
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
          // Used for discount code input
          actions: assign(({ event, context }) => ({
            ...context,
            [event.field]: event.value,
          })),
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
      after: {
        // Mock: always returns no discount after 1s
        1000: {
          target: 'viewingCart',
          actions: assign({ isSubmitting: false, discountAmount: 0 }),
        },
      },
    },

    // ── Checkout ──────────────────────────────────────────────────────────────
    checkout: {
      entry: assign({
        isSubmitting: false,
        errors: {} as Record<string, string>,
      }),

      on: {
        BACK_TO_CART: 'viewingCart',
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field as string];
            return { ...context, [field]: value, errors: newErrors };
          }),
        },
        LOOKUP_MEMBER: 'lookingUpMember',
        PLACE_ORDER: 'validatingCheckout',
        RESET: {
          target: 'browsing',
          actions: assign({ ...emptyContext, sessionId: () => generateSessionId() }),
        },
        TIMEOUT: 'timeout',
      },
    },

    lookingUpMember: {
      entry: assign({ isSubmitting: true }),
      after: {
        // Mock: no match after 1s
        1000: {
          target: 'checkout',
          actions: assign({ isSubmitting: false }),
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
