import type { FeeBreakdown } from '@/lib/types';
import { NextResponse } from 'next/server';
import { sendStoreOrderReceipt } from '@/lib/email';
import { buildServiceFeeAdjustment, buildTaxAdjustment, computeFeeBreakdown, getGatewayProcessors, iqproGet, iqproPost, isIQProConfigured, mapTransactionStatus, tokenizeAch } from '@/lib/iqpro';

export interface ProcessStoreOrderBody {
  // Buyer info
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  address: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;

  // Payment method
  paymentMethod: 'card' | 'ach';

  // Card fields (when paymentMethod === 'card')
  cardholderName?: string;
  cardToken?: string;
  cardFirstSix?: string;
  cardLastFour?: string;
  cardExpiry?: string;

  // ACH fields (when paymentMethod === 'ach')
  achAccountHolder?: string;
  achRoutingNumber?: string;
  achAccountNumber?: string;
  achAccountType?: 'Checking' | 'Savings';

  // Order totals — all server-authoritative (re-validated)
  subtotal: number; // pre-discount, pre-fee subtotal
  discountAmount: number;
  baseAmount: number; // subtotal - discountAmount (amount fees are calculated on)
  feeBreakdown: FeeBreakdown;
  amount: number; // final total (should equal feeBreakdown.amount)
  description: string;
  organizationId: string;
  items: Array<{
    productName: string;
    variantName?: string;
    quantity: number;
    price: number;
  }>;
}

export interface ProcessStoreOrderResult {
  success: boolean;
  status: 'approved' | 'declined' | 'processing';
  transactionId?: string;
  declineReason?: string;
  error?: string;
}

function sanitizePhone(phone?: string): string | undefined {
  if (!phone) {
    return undefined;
  }
  const digits = phone.replace(/\D/g, '');
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return trimmed.slice(0, 10) || undefined;
}

function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\r\n]/g, '');
}

/**
 * POST /api/payment/process
 *
 * Processes a one-time store order payment via IQPro REST API directly
 * (no SDK dependency required).
 * Flow: create customer → register payment method → charge
 */
export async function POST(request: Request) {
  if (!isIQProConfigured()) {
    return NextResponse.json<ProcessStoreOrderResult>(
      { success: false, status: 'declined', error: 'Payment processing is not configured' },
      { status: 503 },
    );
  }

  let body: ProcessStoreOrderBody;
  try {
    body = await request.json() as ProcessStoreOrderBody;
  }
  catch {
    return NextResponse.json<ProcessStoreOrderResult>(
      { success: false, status: 'declined', error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const gatewayId = process.env.IQPRO_GATEWAY_ID!;

  try {
    // ── Step 1: Create customer ───────────────────────────────────────────────
    const customerRes = await iqproPost<{ data?: Record<string, unknown> }>(
      `/api/gateway/${gatewayId}/customer`,
      {
        name: `${body.firstName} ${body.lastName}`,
        referenceId: `kiosk_order_${Date.now()}`,
        addresses: [
          {
            addressLine1: body.address,
            ...(body.addressLine2 && { addressLine2: body.addressLine2 }),
            city: body.city,
            state: body.state,
            postalCode: body.zip,
            country: body.country === 'United States' ? 'US' : body.country,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            ...(sanitizePhone(body.phoneNumber) && { phone: sanitizePhone(body.phoneNumber) }),
            isBilling: true,
          },
        ],
      },
    );

    const customerData = customerRes.data ?? customerRes;
    const customerId = (customerData as Record<string, unknown>).customerId as string;
    console.warn('[payment/process] Customer created:', sanitizeForLog(customerId));

    // Get the customer's billing address ID so the ACH processor can resolve the name
    const customerDetail = await iqproGet<{ data?: Record<string, unknown> }>(
      `/api/gateway/${gatewayId}/customer/${customerId}`,
    );
    const detailData = customerDetail.data ?? customerDetail;
    const addresses = ((detailData as Record<string, unknown>).addresses ?? []) as Array<Record<string, unknown>>;
    const billingAddress = addresses.find(a => a.isBilling);
    const customerBillingAddressId = billingAddress?.customerAddressId as string | undefined;

    // ── Step 2: Register payment method ──────────────────────────────────────
    let paymentMethodId: string;
    let achToken: string | undefined;
    let achAccountType: 'Checking' | 'Savings' | undefined;

    if (body.paymentMethod === 'card') {
      // The client must have tokenized the card via TokenEx before calling
      // this endpoint — we never accept a raw PAN. Missing token/BIN/last-four
      // here means the tokenize step didn't run or was skipped; fail fast
      // rather than sending placeholder values that the gateway would reject.
      if (!body.cardToken || !body.cardFirstSix || !body.cardLastFour || !body.cardExpiry) {
        return NextResponse.json<ProcessStoreOrderResult>(
          { success: false, status: 'declined', error: 'Card was not tokenized. Please re-enter your card.' },
          { status: 400 },
        );
      }
      const maskedCard = `${body.cardFirstSix}******${body.cardLastFour}`;

      const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
        `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
        {
          card: {
            token: body.cardToken,
            expirationDate: body.cardExpiry,
            maskedCard,
          },
          isDefault: true,
        },
      );

      const pmData = (pmRes.data ?? pmRes) as Record<string, unknown>;
      paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? pmData.customerPaymentId ?? '') as string;
    }
    else {
      // ACH: tokenize server-side via Vault API, then register payment method
      achAccountType = body.achAccountType ?? 'Checking';

      const tokenizeResult = await tokenizeAch({
        accountNumber: body.achAccountNumber!,
        routingNumber: body.achRoutingNumber!,
        secCode: 'WEB',
        achAccountType,
      });
      achToken = tokenizeResult.achToken;
      console.warn('[payment/process] ACH tokenization result:', sanitizeForLog(JSON.stringify(tokenizeResult)));

      const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
        `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
        {
          ach: {
            token: achToken,
            secCode: 'WEB',
            routingNumber: body.achRoutingNumber,
            accountType: achAccountType,
            checkNumber: null,
            accountHolderAuth: { dlState: null, dlNumber: null },
          },
          isDefault: true,
        },
      );

      const pmData = (pmRes.data ?? pmRes) as Record<string, unknown>;
      paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? pmData.customerPaymentId ?? '') as string;
      console.warn('[payment/process] ACH paymentMethodId:', sanitizeForLog(paymentMethodId));
    }

    // ── Step 3: Re-validate fee breakdown server-side ───────────────────────
    // Store merchandise is taxable; recompute via IQPro /calculatefees and
    // reject if the client total differs (prevents tampering via devtools).
    if (!body.feeBreakdown || typeof body.feeBreakdown.amount !== 'number') {
      return NextResponse.json<ProcessStoreOrderResult>(
        { success: false, status: 'declined', error: 'Missing fee breakdown' },
        { status: 400 },
      );
    }

    const processors = await getGatewayProcessors();
    const processorId = body.paymentMethod === 'card' ? processors.cardProcessorId : processors.achProcessorId;
    if (!processorId) {
      return NextResponse.json<ProcessStoreOrderResult>(
        { success: false, status: 'declined', error: `No ${body.paymentMethod} processor configured` },
        { status: 503 },
      );
    }

    const serverFees = await computeFeeBreakdown(body.baseAmount, /* isTaxable */ true, {
      processorId,
      token: body.paymentMethod === 'card' ? body.cardToken : achToken,
      creditCardBin: body.paymentMethod === 'card' ? body.cardFirstSix : undefined,
    });

    if (Math.abs(serverFees.amount - body.feeBreakdown.amount) > 0.01) {
      console.error(
        '[payment/process] Fee mismatch — client:',
        sanitizeForLog(body.feeBreakdown.amount),
        'server:',
        sanitizeForLog(serverFees.amount),
      );
      return NextResponse.json<ProcessStoreOrderResult>(
        { success: false, status: 'declined', error: 'Fee breakdown has changed — please refresh and try again' },
        { status: 400 },
      );
    }

    // ── Step 4: paymentAdjustments ─────────────────────────────────────────
    // Store merchandise: Tax adjustment (if tax > 0) + ServiceFee adjustment.
    // Tax is expressed solely via the Tax paymentAdjustment (not via
    // remit.taxAmount) so it shows up distinctly in Basys reporting.
    // ServiceFee flatAmount comes from IQPro /calculatefees (authoritative,
    // avoids fractional-cent rounding discrepancies).
    const paymentAdjustments: Array<Record<string, unknown>> = [];
    if (serverFees.taxAmount > 0) {
      paymentAdjustments.push(buildTaxAdjustment(serverFees));
    }
    paymentAdjustments.push(buildServiceFeeAdjustment(serverFees));

    // ── Step 5: Process one-time charge per canonical IQPro schema ───────────
    //
    // Payment method shape differs by card vs ACH. IQPro rejects any transaction
    // that sends more than one of `card` / `ach` / `customer` under paymentMethod
    // ("Only one payment method is allowed").
    // - CARD: paymentMethod.customer (pulls card details from the vault).
    // - ACH: paymentMethod.ach (inline token/routing/account per Basys ACH
    //   docs). We still vault ACH upstream so it shows on the customer record,
    //   but the charge itself sends the ACH sub-object rather than the vault ref.
    let txPaymentMethod: Record<string, unknown>;
    if (body.paymentMethod === 'ach' && achToken && achAccountType) {
      txPaymentMethod = {
        ach: {
          achToken,
          secCode: 'WEB',
          routingNumber: body.achRoutingNumber,
          accountType: achAccountType,
          checkNumber: null,
          accountHolderAuth: { dlState: null, dlNumber: null },
        },
      };
    }
    else {
      txPaymentMethod = {
        customer: {
          customerId,
          customerPaymentMethodId: paymentMethodId,
          ...(customerBillingAddressId && { customerBillingAddressId }),
        },
      };
    }

    const isTaxable = serverFees.taxAmount > 0;
    const txPayload: Record<string, unknown> = {
      type: 'Sale',
      remit: {
        baseAmount: serverFees.baseAmount,
        // IQPro rejects the request if Remit.TaxAmount is set AND a Tax
        // paymentAdjustment is used ("If Remit TaxAmount is not null, a Tax
        // payment adjustment may not be used."). Send taxAmount: null when a
        // Tax adjustment is present; otherwise 0 for non-taxable transactions.
        taxAmount: isTaxable ? null : 0,
        // Taxable transactions: isTaxExempt: false. Non-taxable (e.g. tax
        // rate = 0): isTaxExempt: true — otherwise IQPro rejects with
        // "Remit.IsTaxExempt must be true when all line items have zero tax".
        isTaxExempt: !isTaxable,
        currencyCode: 'USD',
        addTaxToTotal: true,
        paymentAdjustments,
      },
      paymentMethod: txPaymentMethod,
      address: [
        {
          isPhysical: true,
          isBilling: true,
          isShipping: false,
          firstName: body.firstName || null,
          lastName: body.lastName || null,
          company: null,
          email: body.email || null,
          phone: sanitizePhone(body.phoneNumber) || null,
          addressLine1: body.address || null,
          addressLine2: body.addressLine2 || null,
          city: body.city || null,
          state: body.state || null,
          postalCode: body.zip || null,
          country: (body.country === 'United States' ? 'US' : body.country) || null,
        },
      ],
      lineItems: body.items.map(item => ({
        name: item.productName,
        description: item.variantName ?? item.productName,
        quantity: item.quantity,
        unitPrice: item.price,
        discount: 0,
        freightAmount: 0,
        unitOfMeasureId: 1,
        // IQPro validates that line items carry tax when the remit is
        // non-exempt ("Remit.IsTaxExempt must be true when all line items
        // have zero tax"). Set localTaxPercent to the kiosk tax rate so the
        // line-item-level check passes — IQPro still charges the actual tax
        // via the Tax paymentAdjustment, not from the line-item percent.
        localTaxPercent: isTaxable ? serverFees.taxPct : 0,
        nationalTaxPercent: 0,
      })),
      ...(body.description && { caption: body.description.substring(0, 19) }),
    };

    const txRes = await iqproPost<{ data?: Record<string, unknown> }>(
      `/api/gateway/${gatewayId}/transaction`,
      txPayload,
    );

    const txRaw = txRes.data ?? txRes;
    const txData = ((txRaw as Record<string, unknown>).transaction ?? txRaw) as Record<string, unknown>;
    const responseText = (txData.processorResponseText ?? txData.processorResponseMessage) as string | undefined;
    const txId = (txData.transactionId ?? txData.id ?? '') as string;
    // Anything that isn't an explicit approval status is treated as declined.
    // We never want to send a receipt / mark success on an ambiguous response.
    const mapped = mapTransactionStatus(txData);

    // Send receipt email ONLY on confirmed approval. Never on decline or on an
    // ambiguous/unknown status. Fire-and-forget so a receipt-send failure
    // doesn't propagate into the payment response.
    if (mapped === 'approved' && body.email) {
      sendStoreOrderReceipt({
        toEmail: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        items: body.items ?? [],
        subtotal: body.subtotal,
        discountAmount: body.discountAmount ?? 0,
        taxAmount: serverFees.taxAmount,
        taxPct: serverFees.taxPct,
        serviceFeeAmount: serverFees.serviceFeeAmount,
        serviceFeePct: serverFees.serviceFeePct,
        total: serverFees.amount,
        transactionId: txId || undefined,
      }).catch(() => {
        // Already logged inside sendStoreOrderReceipt — don't let this fail the response
      });
    }

    return NextResponse.json<ProcessStoreOrderResult>({
      success: mapped === 'approved',
      status: mapped,
      transactionId: txId,
      declineReason: mapped === 'declined' ? responseText : undefined,
    });
  }
  catch (error) {
    console.error('[payment/process] Error:', error);
    return NextResponse.json<ProcessStoreOrderResult>({
      success: false,
      status: 'declined',
      error: error instanceof Error ? error.message : 'Payment processing failed',
    });
  }
}
