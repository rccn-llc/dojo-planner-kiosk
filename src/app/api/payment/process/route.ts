import type { FeeBreakdown } from '@/lib/types';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { sendStoreOrderReceipt } from '@/lib/email';
import { buildServiceFeeAdjustment, buildTaxAdjustment, computeFeeBreakdown, getGatewayProcessors, iqproGet, iqproPost, isIQProConfigured, mapTransactionStatus, tokenizeAch, verifyMatchToken } from '@/lib/iqpro';
import { member } from '@/lib/memberSchema';

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

  // Vaulted customer charge: when present, skip create-customer + register-PM
  // and charge the existing IQPro customer's stored payment method directly.
  // The token is signed server-side by /api/payment/saved-payment-method/search
  // and carries the customerId + paymentMethodId; the client never sees them.
  savedPaymentMatchToken?: string;

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

  // Verify the signed match token unconditionally. The downstream branch
  // is gated on the *verified payload*, never on the raw request value, so a
  // tampered or absent token cannot bypass the create-customer + register-PM
  // steps (CWE-807).
  //
  // verifyMatchToken returns null for absent/empty input (→ standard
  // non-vaulted flow) and throws for any present-but-invalid token (→ 400).
  let payload;
  try {
    payload = verifyMatchToken(body.savedPaymentMatchToken);
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid saved payment selection';
    return NextResponse.json<ProcessStoreOrderResult>(
      { success: false, status: 'declined', error: message },
      { status: 400 },
    );
  }
  const vaulted = payload
    ? {
        customerId: payload.customerId,
        customerPaymentMethodId: payload.customerPaymentMethodId,
        paymentMethodType: payload.paymentMethodType,
        cardMaskedNumber: payload.cardMaskedNumber,
      }
    : null;

  try {
    let customerId: string;
    let paymentMethodId: string;
    let customerBillingAddressId: string | undefined;
    let achToken: string | undefined;
    let achAccountType: 'Checking' | 'Savings' | undefined;

    if (vaulted) {
      // Vaulted-customer branch: reuse the existing IQPro customer + PM.
      customerId = vaulted.customerId;
      paymentMethodId = vaulted.customerPaymentMethodId;
      console.warn('[payment/process] Charging vaulted customer:', sanitizeForLog(customerId));
    }
    else {
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
      customerId = (customerData as Record<string, unknown>).customerId as string;
      console.warn('[payment/process] Customer created:', sanitizeForLog(customerId));

      // Get the customer's billing address ID so the ACH processor can resolve the name
      const customerDetail = await iqproGet<{ data?: Record<string, unknown> }>(
        `/api/gateway/${gatewayId}/customer/${customerId}`,
      );
      const detailData = customerDetail.data ?? customerDetail;
      const addresses = ((detailData as Record<string, unknown>).addresses ?? []) as Array<Record<string, unknown>>;
      const billingAddress = addresses.find(a => a.isBilling);
      customerBillingAddressId = billingAddress?.customerAddressId as string | undefined;

      // ── Step 2: Register payment method ──────────────────────────────────────
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
          achAccountType,
        });
        achToken = tokenizeResult.achToken;
        console.warn('[payment/process] ACH tokenization result:', sanitizeForLog(JSON.stringify(tokenizeResult)));

        const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
          `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
          {
            ach: {
              token: achToken,
              secCode: 'PPD',
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

    // Effective payment method: vaulted token's type wins over the body's
    // paymentMethod field (which the client may have left as a placeholder).
    const effectivePaymentMethod: 'card' | 'ach' = vaulted ? vaulted.paymentMethodType : body.paymentMethod;

    const processors = await getGatewayProcessors();
    const processorId = effectivePaymentMethod === 'card' ? processors.cardProcessorId : processors.achProcessorId;
    if (!processorId) {
      return NextResponse.json<ProcessStoreOrderResult>(
        { success: false, status: 'declined', error: `No ${effectivePaymentMethod} processor configured` },
        { status: 503 },
      );
    }

    // For vaulted-card charges we don't have a fresh tokenization token, but
    // we have the masked number from the vault; pull the BIN from there so
    // /calculatefees still gets a valid card identifier.
    const vaultedCardBin = vaulted?.paymentMethodType === 'card' && vaulted.cardMaskedNumber && vaulted.cardMaskedNumber.length >= 6
      ? vaulted.cardMaskedNumber.slice(0, 6)
      : undefined;

    const serverFees = await computeFeeBreakdown(body.baseAmount, /* isTaxable */ true, {
      processorId,
      token: vaulted ? undefined : (effectivePaymentMethod === 'card' ? body.cardToken : achToken),
      creditCardBin: vaulted
        ? vaultedCardBin
        : (effectivePaymentMethod === 'card' ? body.cardFirstSix : undefined),
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
    if (vaulted) {
      // Vaulted-customer charge — both card and ACH go through the customer
      // ref. This is the documented "charge a saved payment method" shape and
      // matches the cancellation-fee flow in the membership API.
      txPaymentMethod = {
        customer: {
          customerId,
          customerPaymentMethodId: paymentMethodId,
        },
      };
    }
    else if (body.paymentMethod === 'ach' && achToken && achAccountType) {
      txPaymentMethod = {
        ach: {
          achToken,
          secCode: 'PPD',
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
      // Vaulted-customer charges: omit the address block entirely. IQPro
      // already has the customer's billing address linked to the vaulted PM,
      // and we don't want a half-filled buyer form to override it on the
      // transaction record.
      ...(vaulted
        ? {}
        : {
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
          }),
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

    // Resolve the receipt recipient. For non-vaulted charges, the buyer
    // form supplies email/name. For vaulted charges, the form is disabled —
    // pull the email + display name from the local member row matching the
    // IQPro customerId.
    let receiptEmail: string | undefined;
    let receiptFirstName: string | undefined;
    let receiptLastName: string | undefined;
    if (vaulted) {
      try {
        const db = getDatabase();
        const rows = await db
          .select({ email: member.email, firstName: member.firstName, lastName: member.lastName })
          .from(member)
          .where(eq(member.iqproCustomerId, vaulted.customerId))
          .limit(1);
        const m = rows[0];
        if (m?.email) {
          receiptEmail = m.email;
          receiptFirstName = m.firstName;
          receiptLastName = m.lastName;
        }
      }
      catch (err) {
        console.error('[payment/process] Failed to look up vaulted member email:', err);
      }
    }
    else {
      receiptEmail = body.email || undefined;
      receiptFirstName = body.firstName;
      receiptLastName = body.lastName;
    }

    // Send receipt email ONLY on confirmed approval. Never on decline or on an
    // ambiguous/unknown status. Fire-and-forget so a receipt-send failure
    // doesn't propagate into the payment response.
    if (mapped === 'approved' && receiptEmail) {
      sendStoreOrderReceipt({
        toEmail: receiptEmail,
        firstName: receiptFirstName ?? '',
        lastName: receiptLastName ?? '',
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
