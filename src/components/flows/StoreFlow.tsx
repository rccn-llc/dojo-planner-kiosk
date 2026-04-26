'use client';

import type { TokenizationIframeConfig } from '../../lib/iqpro';
import type { CartItem, StoreProduct } from '../../machines/types';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LocalMallOutlinedIcon from '@mui/icons-material/LocalMallOutlined';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useStoreMachine } from '../../hooks/useKioskMachines';
import { useTokenExIframe } from '../../hooks/useTokenExIframe';
import { formatPhoneForDisplay, isValidEmail, isValidPhoneNumber, sanitizePhoneInput } from '../../lib/utils';
import { KioskFlowHeader } from '../KioskFlowHeader';
import { KioskSelect } from '../KioskSelect';

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

// ── Price helpers ─────────────────────────────────────────────────────────────

function calculateSubtotal(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function totalItemCount(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.quantity, 0);
}

interface FeeRow {
  label: string;
  amount: number;
}

function feeRowsFromBreakdown(fb: { taxAmount: number; taxPct: number; serviceFeeAmount: number; serviceFeePct: number }): FeeRow[] {
  const rows: FeeRow[] = [];
  if (fb.taxAmount > 0) {
    rows.push({ label: `Tax (${fb.taxPct}%)`, amount: fb.taxAmount });
  }
  if (fb.serviceFeeAmount > 0) {
    rows.push({ label: `Service fee (${fb.serviceFeePct}%)`, amount: fb.serviceFeeAmount });
  }
  return rows;
}

// ── Product image ─────────────────────────────────────────────────────────────

function ProductImage({ src, alt }: { src?: string; alt: string }) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-200">
        <ShoppingCartIcon sx={{ fontSize: 64 }} className="text-gray-400" />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      className="object-cover"
      onError={() => setErrored(true)}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface StoreFlowProps {
  onComplete: () => void;
  onBack: () => void;
}

const TOKENEX_CARD_ID = 'kiosk-tokenex-card';
const TOKENEX_CVV_ID = 'kiosk-tokenex-cvv';

export function StoreFlow({ onComplete, onBack }: StoreFlowProps) {
  const [state, send] = useStoreMachine();
  const [tokenizationConfig, setTokenizationConfig] = useState<TokenizationIframeConfig | null>(null);
  const [tokenizationError, setTokenizationError] = useState<string | null>(null);

  // Fetch tokenization config when entering checkout
  useEffect(() => {
    if (state.matches('checkout') && !tokenizationConfig && !tokenizationError) {
      fetch('/api/payment/tokenization-config')
        .then(r => r.json())
        .then((data: { config?: TokenizationIframeConfig; error?: string }) => {
          if (data.config) {
            setTokenizationConfig(data.config);
          }
          else {
            setTokenizationError(data.error ?? 'Could not load payment form');
          }
        })
        .catch(() => setTokenizationError('Could not load payment form'));
    }
    // Reset when leaving checkout entirely
    if (!state.matches('checkout') && !state.matches('lookingUpMember') && !state.matches('validatingCheckout') && !state.matches('processingOrder')) {
      setTokenizationConfig(null);
      setTokenizationError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // TokenEx iframe hook — only active when config is available and payment method is 'card'
  const isCardPayment = state.context.paymentMethod === 'card';
  const { isLoaded: iframeLoaded, isValid: iframeValid, isCvvValid: iframeCvvValid, error: iframeError, tokenize: iframeTokenize } = useTokenExIframe({
    containerId: TOKENEX_CARD_ID,
    cvvContainerId: TOKENEX_CVV_ID,
    config: isCardPayment ? tokenizationConfig : null,
  });

  // Track tokenizing state separately (not in machine to avoid complexity)
  const processingRef = useRef(false);
  // Holds the token captured once the card becomes valid on the checkout screen.
  // Reused by handlePlaceOrder so we don't tokenize twice.
  const capturedTokenRef = useRef<{ token: string; firstSix: string; lastFour: string } | null>(null);
  // Tracks whether a fee-calc is in flight for the currently-valid card so we
  // don't race duplicate tokenize/calc cycles on re-render.
  const feeCalcInFlightRef = useRef(false);
  const [successCountdown, setSuccessCountdown] = useState(60);

  // When the user completes a valid card entry on the checkout screen, tokenize
  // the card so handlePlaceOrder has a token ready without a second tokenize.
  // Fee calculation is decoupled from this (local math, no BIN needed).
  useEffect(() => {
    if (!state.matches('checkout')) {
      return;
    }
    if (!isCardPayment || !tokenizationConfig) {
      return;
    }
    if (!iframeLoaded || !iframeValid || !iframeCvvValid) {
      // Card not yet valid — clear any prior token so we don't charge a stale one
      if (capturedTokenRef.current) {
        capturedTokenRef.current = null;
      }
      return;
    }
    if (capturedTokenRef.current || feeCalcInFlightRef.current) {
      return;
    }

    feeCalcInFlightRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const result = await iframeTokenize();
        if (cancelled) {
          return;
        }
        capturedTokenRef.current = {
          token: result.token,
          firstSix: result.firstSix ?? '',
          lastFour: result.lastFour ?? '',
        };
      }
      catch (err) {
        console.error('[StoreFlow] Tokenization failed:', err);
      }
      finally {
        feeCalcInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value, isCardPayment, tokenizationConfig, iframeLoaded, iframeValid, iframeCvvValid]);

  // Process payment when machine enters processingOrder.
  // Token was already captured in handlePlaceOrder before the state transition,
  // so the iframe DOM is no longer needed here.
  useEffect(() => {
    if (!state.matches('processingOrder') || processingRef.current) {
      return;
    }

    processingRef.current = true;
    const ctx = state.context;

    const runPayment = async () => {
      try {
        // Use the pre-captured token (set in handlePlaceOrder while iframe was still mounted)
        const captured = capturedTokenRef.current;
        const cardToken = captured?.token ?? ctx.cardToken;
        const cardFirstSix = captured?.firstSix ?? ctx.cardFirstSix;
        const cardLastFour = captured?.lastFour ?? ctx.cardLastFour;

        const subtotal = ctx.cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
        const discountedSubtotal = Math.max(0, subtotal - ctx.discountAmount);

        if (!ctx.feeBreakdown) {
          send({ type: 'PAYMENT_FAILED', error: 'Fee calculation missing. Please try again.' });
          return;
        }

        const body = {
          firstName: ctx.firstName,
          lastName: ctx.lastName,
          email: ctx.email,
          phoneNumber: ctx.phoneNumber,
          address: ctx.address,
          addressLine2: ctx.addressLine2 || undefined,
          city: ctx.city,
          state: ctx.state,
          zip: ctx.zip,
          country: ctx.country,
          paymentMethod: ctx.paymentMethod,
          // Card
          cardholderName: ctx.cardholderName || undefined,
          cardToken: cardToken || undefined,
          cardFirstSix: cardFirstSix || undefined,
          cardLastFour: cardLastFour || undefined,
          cardExpiry: ctx.cardExpiry || undefined,
          // ACH
          achAccountHolder: ctx.achAccountHolder || undefined,
          achRoutingNumber: ctx.achRoutingNumber || undefined,
          achAccountNumber: ctx.achAccountNumber || undefined,
          achAccountType: ctx.achAccountType,
          // Order totals (for receipt email + server validation)
          subtotal,
          discountAmount: ctx.discountAmount,
          baseAmount: discountedSubtotal,
          feeBreakdown: ctx.feeBreakdown,
          amount: ctx.feeBreakdown.amount,
          description: 'Kiosk store order',
          organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? process.env.ORGANIZATION_ID ?? '',
          items: ctx.cartItems.map(i => ({
            productName: i.productName,
            variantName: i.variantName,
            quantity: i.quantity,
            price: i.price,
          })),
        };

        const res = await fetch('/api/payment/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const result = await res.json() as { success: boolean; status: string; declineReason?: string; error?: string };

        if (result.success || result.status === 'approved' || result.status === 'processing') {
          send({ type: 'PAYMENT_SUCCESS' });
        }
        else {
          send({ type: 'PAYMENT_FAILED', error: result.declineReason || result.error || 'Payment declined. Please try again.' });
        }
      }
      catch (err) {
        send({ type: 'PAYMENT_FAILED', error: err instanceof Error ? err.message : 'Payment failed. Please try again.' });
      }
      finally {
        processingRef.current = false;
        capturedTokenRef.current = null;
      }
    };

    runPayment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Fetch products when entering browsing state
  useEffect(() => {
    if (state.matches('browsing') && state.context.isLoadingProducts && state.context.products.length === 0) {
      fetch('/api/catalog')
        .then(r => r.json())
        .then(data => send({ type: 'LOAD_PRODUCTS_SUCCESS', products: data.products ?? [] }))
        .catch(() => send({ type: 'LOAD_PRODUCTS_FAILURE' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Validate discount code when entering applyingDiscount state
  useEffect(() => {
    if (!state.matches('applyingDiscount')) {
      return;
    }
    const subtotal = state.context.cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: state.context.discountCode, subtotal }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data.valid) {
          send({ type: 'DISCOUNT_APPLIED', discountAmount: data.discountAmount });
        }
        else {
          send({ type: 'DISCOUNT_FAILED', error: data.error ?? 'Invalid coupon' });
        }
      })
      .catch(() => send({ type: 'DISCOUNT_FAILED', error: 'Failed to validate coupon' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Handle member lookup when entering lookingUpMember state
  useEffect(() => {
    if (!state.matches('lookingUpMember')) {
      return;
    }
    const phone = state.context.memberSearchPhone;
    fetch('/api/members/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data.found && data.members?.length > 0) {
          const m = data.members[0];
          send({
            type: 'MEMBER_FOUND',
            firstName: m.firstName,
            lastName: m.lastName,
            email: '',
            phone,
          });
        }
        else {
          send({ type: 'MEMBER_NOT_FOUND' });
        }
      })
      .catch(() => send({ type: 'MEMBER_NOT_FOUND' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Calculate fees (tax + service fee) on checkout entry and whenever the base
  // amount, payment method, or captured card token changes. Store items are
  // taxable. The service-fee flatAmount is authoritative from IQPro, so we
  // re-run after tokenization with the real card token.
  useEffect(() => {
    if (!state.matches('checkout')) {
      return;
    }
    const subtotal = calculateSubtotal(state.context.cartItems);
    const baseAmount = Math.max(0, subtotal - state.context.discountAmount);
    if (baseAmount <= 0) {
      return;
    }
    let cancelled = false;
    send({ type: 'CALCULATE_FEES_START' });
    fetch('/api/payment/calculate-fees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseAmount,
        isTaxable: true,
        paymentMethod: state.context.paymentMethod,
        token: capturedTokenRef.current?.token,
        creditCardBin: capturedTokenRef.current?.firstSix,
      }),
    })
      .then(r => r.json() as Promise<{ success: boolean; feeBreakdown?: typeof state.context.feeBreakdown; error?: string }>)
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (data.success && data.feeBreakdown) {
          send({ type: 'CALCULATE_FEES_SUCCESS', feeBreakdown: data.feeBreakdown });
        }
        else {
          send({ type: 'CALCULATE_FEES_FAILURE', error: data.error ?? 'Fee calculation failed' });
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        send({ type: 'CALCULATE_FEES_FAILURE', error: err instanceof Error ? err.message : 'Fee calculation failed' });
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value, state.context.paymentMethod, state.context.discountAmount, state.context.cartItems.length, state.context.cardToken]);

  // Auto-return to home after order success (60s countdown)
  useEffect(() => {
    if (!state.matches('orderSuccess')) {
      return;
    }

    setSuccessCountdown(60);

    // Tick every second
    const interval = setInterval(() => {
      setSuccessCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Navigate home once countdown reaches 0
  useEffect(() => {
    if (successCountdown === 0 && state.matches('orderSuccess')) {
      onComplete();
    }
  }, [successCountdown, state, onComplete]);

  // ── Shared styles (match MembershipFlow exactly) ────────────────────────────
  const labelClass = 'block text-lg font-semibold text-black mb-2';
  const inputClass = (field: string) =>
    `w-full text-xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black ${
      state.context.errors?.[field] ? 'border-red-400 focus:ring-red-500' : 'border-gray-300'
    }`;

  // ── Phone auto-format ───────────────────────────────────────────────────────
  const handleInputChange = (field: string, value: string | boolean) => {
    if ((field === 'phoneNumber' || field === 'memberSearchPhone') && typeof value === 'string') {
      const cleaned = sanitizePhoneInput(value);
      if (cleaned.length <= 10) {
        send({ type: 'UPDATE_FIELD', field, value: formatPhoneForDisplay(cleaned) });
      }
    }
    else {
      send({ type: 'UPDATE_FIELD', field, value });
    }
  };

  // ── Back button routing ─────────────────────────────────────────────────────
  const handleBack = () => {
    if (state.matches('browsing')) {
      return onBack();
    }
    if (state.matches('viewingProduct')) {
      return send({ type: 'BACK_TO_BROWSE' });
    }
    if (state.matches('viewingCart')) {
      return send({ type: 'BACK_TO_BROWSE' });
    }
    if (
      state.matches('checkout')
      || state.matches('validatingCheckout')
      || state.matches('lookingUpMember')
    ) {
      return send({ type: 'BACK_TO_CART' });
    }
    send({ type: 'RESET' });
  };

  // ── Header title ────────────────────────────────────────────────────────────
  const headerTitle = () => {
    if (state.matches('browsing')) {
      return 'Shop';
    }
    if (state.matches('viewingProduct')) {
      return state.context.selectedProduct?.name ?? 'Product';
    }
    if (state.matches('viewingCart') || state.matches('applyingDiscount')) {
      return 'Cart';
    }
    if (
      state.matches('checkout')
      || state.matches('lookingUpMember')
      || state.matches('validatingCheckout')
    ) {
      return 'Checkout';
    }
    if (state.matches('processingOrder')) {
      return 'Processing…';
    }
    if (state.matches('orderSuccess')) {
      return 'Order Placed!';
    }
    if (state.matches('orderFailed')) {
      return 'Payment Failed';
    }
    if (state.matches('timeout')) {
      return 'Session Timeout';
    }
    return 'Shop';
  };

  // ── Derived pricing ─────────────────────────────────────────────────────────
  const subtotal = calculateSubtotal(state.context.cartItems);
  const feeBreakdown = state.context.feeBreakdown;
  const discountedSubtotal = Math.max(0, subtotal - state.context.discountAmount);
  const total = feeBreakdown ? feeBreakdown.amount : discountedSubtotal;
  const itemCount = totalItemCount(state.context.cartItems);
  const cartLength = state.context.cartItems.length;

  // Cart button shown only when browsing or viewing a product
  const showCartButton = state.matches('browsing') || state.matches('viewingProduct');

  // Gray background only on browse screen
  const mainBg = state.matches('browsing') ? 'bg-gray-100' : 'bg-white';

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <KioskFlowHeader
        title={headerTitle()}
        onBack={handleBack}
        rightSlot={showCartButton
          ? (
              <button
                type="button"
                onClick={() => send({ type: 'VIEW_CART' })}
                className="flex items-center gap-2 rounded-full border-2 border-white px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-white hover:text-black sm:px-5 sm:py-2 sm:text-lg"
              >
                <ShoppingCartIcon sx={{ fontSize: 24 }} />
                Cart
                {cartLength > 0 && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-bold text-black">
                    {cartLength}
                  </span>
                )}
              </button>
            )
          : undefined}
      />

      {/* Main content */}
      <main className={`flex flex-1 items-start justify-center p-4 sm:p-6 md:p-8 ${mainBg}`}>

        {/* ── Browse ─────────────────────────────────────────────────────────── */}
        {state.matches('browsing') && (
          <div className="w-full max-w-5xl">
            {state.context.isLoadingProducts
              ? (
                  // Loading skeleton
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                    {[1, 2, 3].map(n => (
                      <div key={n} className="animate-pulse rounded-3xl bg-white p-6 shadow-md">
                        <div className="mb-4 aspect-square w-full rounded-2xl bg-gray-300" />
                        <div className="mb-2 h-6 w-3/4 rounded bg-gray-300" />
                        <div className="h-5 w-1/3 rounded bg-gray-300" />
                      </div>
                    ))}
                  </div>
                )
              : state.context.products.length === 0
                ? (
                    <div className="flex flex-col items-center py-16 text-center">
                      <ShoppingCartIcon sx={{ fontSize: 80 }} className="mb-6 text-gray-400" />
                      <p className="text-2xl text-gray-500">No items available right now.</p>
                    </div>
                  )
                : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                      {state.context.products.map((product: StoreProduct) => (
                        <button
                          type="button"
                          key={product.id}
                          onClick={() => send({ type: 'VIEW_PRODUCT', product })}
                          className="cursor-pointer rounded-3xl bg-white p-6 text-left shadow-md transition-all hover:scale-105 hover:shadow-lg"
                        >
                          <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-2xl bg-gray-200">
                            <ProductImage
                              src={product.images[0]}
                              alt={product.name}
                            />
                          </div>
                          <h3 className="text-xl font-bold text-black">{product.name}</h3>
                          <p className="mt-1 text-lg text-gray-600">
                            {product.priceRange
                              ? `${formatCurrency(product.priceRange.min)} – ${formatCurrency(product.priceRange.max)}`
                              : formatCurrency(product.basePrice)}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
          </div>
        )}

        {/* ── Product detail ──────────────────────────────────────────────────── */}
        {state.matches('viewingProduct') && state.context.selectedProduct && (
          <div className="w-full max-w-5xl">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-5 md:gap-8">
              {/* Image */}
              <div className="md:col-span-3">
                <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-gray-100">
                  <ProductImage
                    src={state.context.selectedProduct.images[0]}
                    alt={state.context.selectedProduct.name}
                  />
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-col gap-6 md:col-span-2">
                <h2 className="text-3xl font-bold text-black">
                  {state.context.selectedProduct.name}
                </h2>

                {/* Variant selector */}
                {state.context.selectedProduct.variants && state.context.selectedProduct.variants.length === 1 && (
                  <div>
                    <p className={labelClass}>Option</p>
                    <p className="text-xl text-black">
                      {state.context.selectedProduct.variants[0]!.name}
                      {' '}
                      —
                      {' '}
                      {formatCurrency(state.context.selectedProduct.variants[0]!.price)}
                    </p>
                  </div>
                )}
                {state.context.selectedProduct.variants && state.context.selectedProduct.variants.length > 1 && (
                  <div>
                    <KioskSelect
                      id="variantSelect"
                      value={state.context.selectedVariantId}
                      onChange={v => send({ type: 'SELECT_VARIANT', variantId: v })}
                      label="Select Option"
                      placeholder="Choose an option"
                      options={state.context.selectedProduct.variants.map(v => ({
                        value: v.id,
                        label: `${v.name} — ${formatCurrency(v.price)}`,
                      }))}
                      error={state.context.errors?.selectedVariantId}
                    />
                  </div>
                )}

                {/* Price (no-variant products) */}
                {(!state.context.selectedProduct.variants || state.context.selectedProduct.variants.length === 0) && (
                  <p className="text-3xl font-bold text-black">
                    {formatCurrency(state.context.selectedProduct.basePrice)}
                  </p>
                )}

                {/* Quantity stepper */}
                <div>
                  <p className={labelClass}>Quantity</p>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => send({ type: 'UPDATE_QUANTITY', quantity: state.context.selectedQuantity - 1 })}
                      className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-xl border-2 border-black text-2xl font-bold text-black transition-colors hover:bg-gray-100"
                    >
                      −
                    </button>
                    <span className="w-16 text-center text-2xl font-bold text-black">
                      {state.context.selectedQuantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => send({ type: 'UPDATE_QUANTITY', quantity: state.context.selectedQuantity + 1 })}
                      className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-xl border-2 border-black text-2xl font-bold text-black transition-colors hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Add to Cart */}
                <button
                  type="button"
                  onClick={() => send({ type: 'ADD_TO_CART' })}
                  className="min-h-16 w-full cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800"
                >
                  <ShoppingCartIcon sx={{ fontSize: 22, mr: 1 }} />
                  Add to Cart
                </button>

                {/* Description */}
                {state.context.selectedProduct.description && (
                  <div>
                    <p className="mb-2 text-lg font-semibold text-black">Description</p>
                    <p className="text-base leading-relaxed text-gray-600">
                      {state.context.selectedProduct.description}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Cart ───────────────────────────────────────────────────────────── */}
        {(state.matches('viewingCart') || state.matches('applyingDiscount')) && (
          <div className="w-full max-w-5xl">
            {/* Back to catalog */}
            {cartLength > 0 && (
              <button
                type="button"
                onClick={() => send({ type: 'BACK_TO_BROWSE' })}
                className="mx-auto mb-6 flex min-h-14 cursor-pointer items-center gap-2 rounded-2xl border-2 border-gray-300 bg-white px-6 py-3 text-lg font-semibold text-black transition-colors hover:border-black hover:bg-gray-50"
              >
                <LocalMallOutlinedIcon sx={{ fontSize: 24 }} />
                Continue Shopping
              </button>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
              {/* Items list */}
              <div className="rounded-3xl border-2 border-gray-200 bg-white p-6 lg:col-span-3">
                <h2 className="mb-6 text-2xl font-bold text-black">Confirm cart details</h2>

                {cartLength === 0
                  ? (
                      <div className="flex flex-col items-center py-16 text-center">
                        <ShoppingCartIcon sx={{ fontSize: 64 }} className="mb-4 text-gray-400" />
                        <p className="mb-6 text-xl text-gray-500">Your cart is empty.</p>
                        <button
                          type="button"
                          onClick={() => send({ type: 'BACK_TO_BROWSE' })}
                          className="min-h-16 cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800"
                        >
                          Continue shopping
                        </button>
                      </div>
                    )
                  : (
                      <div className="space-y-4">
                        {state.context.cartItems.map(item => (
                          <div
                            key={`${item.productId}-${item.variantId ?? 'novariant'}`}
                            className="flex items-center justify-between rounded-2xl border border-gray-200 p-5"
                          >
                            <div className="flex-1">
                              <p className="text-xl font-bold text-black">{item.productName}</p>
                              {item.variantName && (
                                <p className="text-base text-gray-500">{item.variantName}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-xl font-bold text-black">
                                {formatCurrency(item.price * item.quantity)}
                              </span>
                              <span className="rounded-lg border border-gray-300 px-3 py-1 text-base text-gray-700">
                                Qty:
                                {' '}
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => send({
                                  type: 'REMOVE_ITEM',
                                  productId: item.productId,
                                  variantId: item.variantId,
                                })}
                                className="cursor-pointer p-2 text-red-500 transition-colors hover:text-red-700"
                                aria-label="Remove item"
                              >
                                <DeleteOutlineIcon sx={{ fontSize: 28 }} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
              </div>

              {/* Pricing summary */}
              <div className="lg:col-span-2">
                <div className="sticky top-4 space-y-4 rounded-3xl border-2 border-gray-200 bg-gray-50 p-6">
                  {/* Discount code */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={state.context.discountCode}
                      onChange={e => handleInputChange('discountCode', e.target.value)}
                      placeholder="Enter discount code"
                      className="flex-1 rounded-xl border-2 border-gray-300 p-3 text-lg placeholder:text-gray-600 focus:border-black focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => send({ type: 'APPLY_DISCOUNT' })}
                      disabled={
                        !state.context.discountCode.trim()
                        || state.matches('applyingDiscount')
                      }
                      className="cursor-pointer rounded-xl border-2 border-black bg-black px-4 py-3 text-base font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>

                  {/* Subtotal */}
                  <div className="flex justify-between border-t border-gray-200 pt-4 text-xl">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-bold text-black">{formatCurrency(subtotal)}</span>
                  </div>

                  {/* Total */}
                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold text-black">
                        Total
                        {' '}
                        <span className="text-base font-normal text-gray-500">
                          (
                          {itemCount}
                          {' '}
                          {itemCount === 1 ? 'item' : 'items'}
                          )
                        </span>
                      </span>
                      <span className="text-xl font-bold text-black">
                        {formatCurrency(total)}
                      </span>
                    </div>
                    {cartLength > 0 && (
                      <p className="mt-1 text-right text-sm text-gray-400">
                        Taxes and fees calculated at checkout
                      </p>
                    )}
                  </div>

                  {/* Proceed to checkout */}
                  <button
                    type="button"
                    onClick={() => send({ type: 'PROCEED_TO_CHECKOUT' })}
                    disabled={cartLength === 0}
                    className="min-h-16 w-full cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-300"
                  >
                    Proceed to Checkout
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Checkout ───────────────────────────────────────────────────────── */}
        {(
          state.matches('checkout')
          || state.matches('lookingUpMember')
          || state.matches('validatingCheckout')
        ) && (
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
              {/* Left: buyer form */}
              <div className="space-y-6 lg:col-span-3">
                {/* Member search */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                  <p className="mb-3 text-base font-semibold tracking-wide text-gray-500 uppercase">
                    Already a member? We'll fill in your details.
                  </p>
                  <div className="flex gap-3">
                    <input
                      type="tel"
                      value={state.context.memberSearchPhone}
                      onChange={e => handleInputChange('memberSearchPhone', e.target.value)}
                      placeholder="Search for member by phone"
                      className="flex-1 rounded-xl border-2 border-gray-300 p-4 text-xl placeholder:text-gray-600 focus:border-black focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => send({ type: 'LOOKUP_MEMBER' })}
                      disabled={
                        state.matches('lookingUpMember')
                        || !(state.context.memberSearchPhone?.replace(/\D/g, '').length >= 10)
                      }
                      className="cursor-pointer rounded-xl border-2 border-black bg-black px-6 py-4 text-base font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {state.matches('lookingUpMember') ? 'Looking up…' : 'Look Up'}
                    </button>
                  </div>
                </div>

                {/* Buyer details */}
                <p className="text-xl font-semibold text-black">Buyer Details</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="firstName">
                      First name
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      value={state.context.firstName}
                      onChange={e => handleInputChange('firstName', e.target.value)}
                      className={inputClass('firstName')}
                      placeholder="First name"
                    />
                    {state.context.errors?.firstName && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.firstName}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="lastName">
                      Last name
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      value={state.context.lastName}
                      onChange={e => handleInputChange('lastName', e.target.value)}
                      className={inputClass('lastName')}
                      placeholder="Last name"
                    />
                    {state.context.errors?.lastName && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.lastName}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="email">
                      Email address
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={state.context.email}
                      onChange={e => handleInputChange('email', e.target.value)}
                      className={inputClass('email')}
                      placeholder="email@example.com"
                    />
                    {state.context.errors?.email && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.email}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="phoneNumber">
                      Phone number
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="phoneNumber"
                      type="tel"
                      value={state.context.phoneNumber}
                      onChange={e => handleInputChange('phoneNumber', e.target.value)}
                      className={inputClass('phoneNumber')}
                      placeholder="(555) 123-4567"
                    />
                    {state.context.errors?.phoneNumber && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.phoneNumber}</p>
                    )}
                  </div>

                  {/* Country */}
                  <div className="sm:col-span-2">
                    <KioskSelect
                      id="country"
                      value={state.context.country}
                      onChange={v => handleInputChange('country', v)}
                      label="Country"
                      options={[{ value: 'United States', label: 'United States' }]}
                    />
                  </div>

                  {/* Address */}
                  <div className="sm:col-span-2">
                    <label className={labelClass} htmlFor="address">
                      Address line 1
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="address"
                      type="text"
                      value={state.context.address}
                      onChange={e => handleInputChange('address', e.target.value)}
                      className={inputClass('address')}
                      placeholder="123 Main St"
                    />
                    {state.context.errors?.address && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.address}</p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass} htmlFor="addressLine2">Address line 2</label>
                    <input
                      id="addressLine2"
                      type="text"
                      value={state.context.addressLine2}
                      onChange={e => handleInputChange('addressLine2', e.target.value)}
                      className={inputClass('addressLine2')}
                      placeholder="Apt, Suite, etc. (optional)"
                    />
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="city">
                      City
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="city"
                      type="text"
                      value={state.context.city}
                      onChange={e => handleInputChange('city', e.target.value)}
                      className={inputClass('city')}
                      placeholder="City"
                    />
                    {state.context.errors?.city && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.city}</p>
                    )}
                  </div>
                  <KioskSelect
                    id="state"
                    value={state.context.state}
                    onChange={v => handleInputChange('state', v)}
                    label="State / Province / Region"
                    required
                    options={US_STATES.map(s => ({ value: s, label: s }))}
                    placeholder="Select state…"
                    error={state.context.errors?.state}
                  />

                  <div>
                    <label className={labelClass} htmlFor="zip">
                      Postal Code
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="zip"
                      type="text"
                      value={state.context.zip}
                      onChange={e => handleInputChange('zip', e.target.value)}
                      className={inputClass('zip')}
                      placeholder="12345"
                    />
                    {state.context.errors?.zip && (
                      <p className="mt-1 text-base text-red-600">{state.context.errors.zip}</p>
                    )}
                  </div>
                </div>

              </div>

              {/* Right: payment + order summary */}
              <div className="lg:col-span-2">
                <div className="sticky top-4 space-y-5 rounded-3xl border-2 border-gray-200 bg-gray-50 p-6">
                  {/* Payment method tabs */}
                  <div>
                    <p className={labelClass}>Payment method</p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => handleInputChange('paymentMethod', 'card')}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-3 text-lg font-bold transition-colors ${
                          state.context.paymentMethod === 'card'
                            ? 'border-black bg-black text-white'
                            : 'border-gray-300 bg-white text-black hover:border-black'
                        }`}
                      >
                        Credit card
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInputChange('paymentMethod', 'ach')}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-3 text-lg font-bold transition-colors ${
                          state.context.paymentMethod === 'ach'
                            ? 'border-black bg-black text-white'
                            : 'border-gray-300 bg-white text-black hover:border-black'
                        }`}
                      >
                        Bank (ACH)
                      </button>
                    </div>
                  </div>

                  {/* Card payment form */}
                  {state.context.paymentMethod === 'card' && (
                    <div className="space-y-4">
                      <div>
                        <label className={labelClass} htmlFor="cardholderName">Cardholder name</label>
                        <input
                          id="cardholderName"
                          type="text"
                          value={state.context.cardholderName}
                          onChange={e => handleInputChange('cardholderName', e.target.value)}
                          className={inputClass('cardholderName')}
                          placeholder="Name on card"
                        />
                      </div>

                      <div>
                        <p className={labelClass}>Card number</p>
                        {tokenizationError
                          ? (
                              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base text-red-600">
                                {tokenizationError}
                              </div>
                            )
                          : !tokenizationConfig
                              ? (
                                  <div className="flex items-center gap-3 rounded-xl border-2 border-gray-300 bg-white p-4 text-lg text-gray-400">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                                    Loading card form…
                                  </div>
                                )
                              : (
                                  <>
                                    {!iframeLoaded && !iframeError && (
                                      <div className="flex items-center gap-3 rounded-xl border-2 border-gray-300 bg-white p-4 text-lg text-gray-400">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                                        Loading card form…
                                      </div>
                                    )}
                                    {iframeError && (
                                      <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base text-red-600">
                                        {iframeError}
                                      </div>
                                    )}
                                    <div
                                      id={TOKENEX_CARD_ID}
                                      className={`w-full overflow-hidden rounded-xl border-2 border-gray-300 bg-white [&_iframe]:border-none ${!iframeLoaded && !iframeError ? 'hidden' : ''}`}
                                      style={{ height: '56px' }}
                                    />
                                  </>
                                )}
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className={labelClass} htmlFor="cardExpiry">Expiry (MM/YY)</label>
                          <input
                            id="cardExpiry"
                            type="text"
                            value={state.context.cardExpiry}
                            onChange={e => handleInputChange('cardExpiry', e.target.value)}
                            className={inputClass('cardExpiry')}
                            placeholder="MM/YY"
                            maxLength={5}
                          />
                        </div>
                        <div>
                          <p className={labelClass}>CVV</p>
                          {tokenizationConfig
                            ? (
                                <div
                                  id={TOKENEX_CVV_ID}
                                  className={`w-full overflow-hidden rounded-xl border-2 border-gray-300 bg-white [&_iframe]:border-none ${!iframeLoaded ? 'opacity-0' : ''}`}
                                  style={{ height: '56px' }}
                                />
                              )
                            : (
                                <div className="h-14 rounded-xl border-2 border-gray-300 bg-white" />
                              )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ACH payment form */}
                  {state.context.paymentMethod === 'ach' && (
                    <div className="space-y-4">
                      <div>
                        <label className={labelClass} htmlFor="achAccountHolder">Account holder name</label>
                        <input
                          id="achAccountHolder"
                          type="text"
                          value={state.context.achAccountHolder}
                          onChange={e => handleInputChange('achAccountHolder', e.target.value)}
                          className={inputClass('achAccountHolder')}
                          placeholder="Name on account"
                        />
                      </div>
                      <KioskSelect
                        id="achAccountType"
                        value={state.context.achAccountType}
                        onChange={v => handleInputChange('achAccountType', v)}
                        label="Account type"
                        options={[
                          { value: 'Checking', label: 'Checking' },
                          { value: 'Savings', label: 'Savings' },
                        ]}
                      />
                      <div>
                        <label className={labelClass} htmlFor="achRoutingNumber">Routing number</label>
                        <input
                          id="achRoutingNumber"
                          type="text"
                          inputMode="numeric"
                          value={state.context.achRoutingNumber}
                          onChange={e => handleInputChange('achRoutingNumber', e.target.value.replace(/\D/g, '').slice(0, 9))}
                          className={inputClass('achRoutingNumber')}
                          placeholder="9-digit routing number"
                          maxLength={9}
                        />
                        {state.context.achRoutingNumber && state.context.achRoutingNumber.length !== 9 && (
                          <p className="mt-1 text-base text-red-600">Routing number must be 9 digits</p>
                        )}
                      </div>
                      <div>
                        <label className={labelClass} htmlFor="achAccountNumber">Account number</label>
                        <input
                          id="achAccountNumber"
                          type="password"
                          autoComplete="off"
                          value={state.context.achAccountNumber}
                          onChange={e => handleInputChange('achAccountNumber', e.target.value.replace(/\D/g, ''))}
                          className={inputClass('achAccountNumber')}
                          placeholder="Account number"
                        />
                      </div>
                    </div>
                  )}

                  {/* Discount code */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={state.context.discountCode}
                      onChange={e => handleInputChange('discountCode', e.target.value)}
                      placeholder="Optional discount code"
                      className="flex-1 rounded-xl border-2 border-gray-300 p-3 text-lg placeholder:text-gray-600 focus:border-black focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!state.context.discountCode.trim()}
                      className="cursor-pointer rounded-xl border-2 border-gray-300 px-4 py-3 text-base font-bold text-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>

                  {/* Order total */}
                  <div className="space-y-2 border-t border-gray-200 pt-4 text-base">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    {state.context.discountAmount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount</span>
                        <span>
                          -
                          {formatCurrency(state.context.discountAmount)}
                        </span>
                      </div>
                    )}
                    {feeBreakdown && feeRowsFromBreakdown(feeBreakdown).map(row => (
                      <div key={row.label} className="flex justify-between text-gray-600">
                        <span>{row.label}</span>
                        <span>{formatCurrency(row.amount)}</span>
                      </div>
                    ))}
                    {state.context.isCalculatingFees && (
                      <div className="text-right text-sm text-gray-400">Calculating fees…</div>
                    )}
                    <div className="flex items-center justify-between border-t border-gray-200 pt-3 text-xl font-bold text-black">
                      <span>
                        Total
                        {' '}
                        <span className="text-base font-normal text-gray-500">
                          (
                          {itemCount}
                          {' '}
                          {itemCount === 1 ? 'item' : 'items'}
                          )
                        </span>
                      </span>
                      <span>{formatCurrency(total)}</span>
                    </div>
                  </div>

                  {/* Place order */}
                  {(() => {
                    const ctx = state.context;
                    const isBuyerReady = !!ctx.firstName?.trim()
                      && !!ctx.lastName?.trim()
                      && !!ctx.email?.trim()
                      && isValidEmail(ctx.email)
                      && !!ctx.phoneNumber?.trim()
                      && isValidPhoneNumber(ctx.phoneNumber)
                      && !!ctx.address?.trim()
                      && !!ctx.city?.trim()
                      && !!ctx.state?.trim()
                      && !!ctx.zip?.trim();

                    const isPaymentReady = ctx.paymentMethod === 'card'
                      ? (!tokenizationConfig || (iframeLoaded && iframeValid && iframeCvvValid)) && !!ctx.cardholderName && !!ctx.cardExpiry
                      : !!ctx.achAccountHolder
                        && ctx.achRoutingNumber.length === 9
                        && !!ctx.achAccountNumber;

                    const handlePlaceOrder = async () => {
                      // Card: token + fee breakdown were already captured when the card
                      // became valid on this screen (see the auto-tokenize effect above).
                      // ACH: fees were calculated on entry; no tokenize needed here —
                      // the server-side /api/payment/process route tokenizes via Vault.
                      if (state.context.paymentMethod === 'card' && tokenizationConfig) {
                        if (!capturedTokenRef.current) {
                          send({ type: 'PAYMENT_FAILED', error: 'Card not ready. Please re-enter your card.' });
                          return;
                        }
                      }
                      if (!state.context.feeBreakdown) {
                        send({ type: 'PAYMENT_FAILED', error: 'Fees still calculating. Please wait a moment and try again.' });
                        return;
                      }
                      send({ type: 'PLACE_ORDER' });
                    };

                    return (
                      <button
                        type="button"
                        onClick={handlePlaceOrder}
                        disabled={
                          !isBuyerReady
                          || !isPaymentReady
                          || !state.context.feeBreakdown
                          || state.context.isCalculatingFees
                          || state.context.isSubmitting
                          || state.matches('lookingUpMember')
                        }
                        className="min-h-16 w-full cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {state.context.isCalculatingFees
                          ? 'Calculating fees…'
                          : state.context.isSubmitting
                            ? 'Validating…'
                            : 'Place order'}
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Processing ──────────────────────────────────────────────────────── */}
        {state.matches('processingOrder') && (
          <div className="w-full max-w-xl py-16 text-center">
            <div className="mx-auto mb-8 h-16 w-16 animate-spin rounded-full border-4 border-black border-t-transparent" />
            <h2 className="mb-4 text-3xl font-bold text-black">
              Processing your order…
            </h2>
            <p className="text-xl text-gray-500">Please don't leave this screen</p>
          </div>
        )}

        {/* ── Order success ───────────────────────────────────────────────────── */}
        {state.matches('orderSuccess') && (
          <div className="w-full max-w-2xl py-8">
            {/* Success header */}
            <div className="mb-8 text-center">
              <CheckCircleOutlineIcon sx={{ fontSize: 96 }} className="mb-4 text-black" />
              <h2 className="mb-2 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Order Placed!</h2>
              <p className="text-xl text-gray-600">
                {state.context.firstName
                  ? `Thank you, ${state.context.firstName}! Your order has been placed successfully.`
                  : 'Your order has been placed successfully.'}
              </p>
              {state.context.email && (
                <p className="mt-2 text-base text-gray-500">
                  A receipt has been sent to
                  {' '}
                  <span className="font-semibold text-black">{state.context.email}</span>
                </p>
              )}
            </div>

            {/* Order summary */}
            <div className="mb-8 rounded-3xl border-2 border-gray-200 bg-gray-50 p-6">
              <h3 className="mb-4 text-xl font-bold text-black">Order Summary</h3>
              <div className="space-y-3">
                {state.context.cartItems.map(item => (
                  <div key={`${item.productId}-${item.variantId ?? 'novariant'}`} className="flex items-center justify-between">
                    <span className="text-lg text-gray-800">
                      {item.productName}
                      {item.variantName && (
                        <span className="text-gray-500">
                          {' '}
                          —
                          {item.variantName}
                        </span>
                      )}
                      <span className="ml-2 text-gray-500">
                        ×
                        {item.quantity}
                      </span>
                    </span>
                    <span className="text-lg font-semibold text-black">
                      {formatCurrency(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-1 border-t border-gray-200 pt-4">
                <div className="flex justify-between text-base text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {state.context.discountAmount > 0 && (
                  <div className="flex justify-between text-base text-green-600">
                    <span>Discount</span>
                    <span>
                      -
                      {formatCurrency(state.context.discountAmount)}
                    </span>
                  </div>
                )}
                {feeBreakdown && feeRowsFromBreakdown(feeBreakdown).map(row => (
                  <div key={row.label} className="flex justify-between text-base text-gray-500">
                    <span>{row.label}</span>
                    <span>{formatCurrency(row.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-300 pt-2 text-xl font-bold text-black">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="text-center">
              <button
                type="button"
                onClick={onComplete}
                className="cursor-pointer rounded-2xl border-2 border-black bg-black px-16 py-5 text-xl font-bold text-white transition-colors hover:bg-gray-800"
              >
                Done
              </button>

              {/* Countdown ring */}
              <div className="mt-8 flex flex-col items-center gap-2">
                <div className="relative h-16 w-16">
                  <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="4"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="#000000"
                      strokeWidth="4"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - successCountdown / 60)}`}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-black">
                    {successCountdown}
                  </span>
                </div>
                <p className="text-base text-gray-400">
                  Returning to home in
                  {' '}
                  {successCountdown}
                  {' '}
                  second
                  {successCountdown !== 1 ? 's' : ''}
                  …
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Order failed ────────────────────────────────────────────────────── */}
        {state.matches('orderFailed') && (
          <div className="w-full max-w-2xl py-8 text-center">
            <div className="rounded-3xl border-2 border-red-200 bg-white p-6 sm:p-8 md:p-12">
              <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Payment Failed</h2>
              <p className="mb-8 text-xl text-red-600">
                {state.context.errors?.general || 'There was an issue processing your payment.'}
              </p>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-gray-300 bg-white px-8 py-5 text-xl font-bold text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Timeout ─────────────────────────────────────────────────────────── */}
        {state.matches('timeout') && (
          <div className="w-full max-w-xl py-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-black">Session Timeout</h2>
            <p className="mb-4 text-xl text-orange-600">
              For security, your session has timed out.
            </p>
            <p className="text-lg text-gray-500">Returning to shop…</p>
          </div>
        )}

      </main>
    </div>
  );
}
