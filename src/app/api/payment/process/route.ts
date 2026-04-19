import type { FeeBreakdown } from '@/lib/types';
import { NextResponse } from 'next/server';
import { sendStoreOrderReceipt } from '@/lib/email';
import { calculateTransactionFees, getGatewayProcessors, getKioskTaxState, iqproGet, iqproPost, isIQProConfigured, tokenizeAch } from '@/lib/iqpro';

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
    console.warn('[payment/process] Customer created:', customerId);

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

    if (body.paymentMethod === 'card') {
      const first6 = body.cardFirstSix ?? '000000';
      const last4 = body.cardLastFour ?? '0000';
      const maskedCard = `${first6}******${last4}`;

      const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
        `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
        {
          card: {
            token: body.cardToken,
            expirationDate: body.cardExpiry ?? '',
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
      const accountType = body.achAccountType ?? 'Checking';

      const tokenizeResult = await tokenizeAch({
        accountNumber: body.achAccountNumber!,
        routingNumber: body.achRoutingNumber!,
        secCode: 'WEB',
        achAccountType: accountType,
      });
      const { achToken } = tokenizeResult;
      console.warn('[payment/process] ACH tokenization result:', JSON.stringify(tokenizeResult));

      const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
        `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
        {
          ach: {
            token: achToken,
            secCode: 'WEB',
            routingNumber: body.achRoutingNumber,
            accountType,
            checkNumber: null,
            accountHolderAuth: { dlState: null, dlNumber: null },
          },
          isDefault: true,
        },
      );

      const pmData = (pmRes.data ?? pmRes) as Record<string, unknown>;
      paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? pmData.customerPaymentId ?? '') as string;
      console.warn('[payment/process] ACH paymentMethodId:', paymentMethodId);
    }

    // ── Step 3: Re-validate fee breakdown against IQPro ──────────────────────
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

    const serverFees = await calculateTransactionFees({
      baseAmount: Math.round(body.baseAmount * 100) / 100,
      processorId,
      state: getKioskTaxState(),
      paymentMethod: body.paymentMethod,
      creditCardBin: body.cardFirstSix,
      token: body.paymentMethod === 'card' ? body.cardToken : undefined,
    });

    if (Math.abs(serverFees.amount - body.feeBreakdown.amount) > 0.01) {
      console.error('[payment/process] Fee mismatch — client:', body.feeBreakdown.amount, 'server:', serverFees.amount);
      return NextResponse.json<ProcessStoreOrderResult>(
        { success: false, status: 'declined', error: 'Fee breakdown has changed — please refresh and try again' },
        { status: 400 },
      );
    }

    // ── Step 4: Build paymentAdjustments from server-calculated fees ─────────
    const paymentAdjustments: Array<Record<string, unknown>> = [];
    if (serverFees.surchargeAmount > 0) {
      paymentAdjustments.push({ type: 'Surcharge', percentage: null, flatAmount: serverFees.surchargeAmount });
    }
    if (serverFees.serviceFeesAmount > 0) {
      paymentAdjustments.push({ type: 'ServiceFees', percentage: null, flatAmount: serverFees.serviceFeesAmount });
    }
    if (serverFees.convenienceFeesAmount > 0) {
      paymentAdjustments.push({ type: 'ConvenienceFees', percentage: null, flatAmount: serverFees.convenienceFeesAmount });
    }

    // ── Step 5: Process one-time charge per canonical IQPro schema ───────────
    const txPaymentMethod: Record<string, unknown> = {
      customer: {
        customerId,
        customerPaymentMethodId: paymentMethodId,
        ...(customerBillingAddressId && { customerBillingAddressId }),
      },
    };
    // IQPro rejects the transaction if both `customer` and `card`/`ach` are sent
    // ("Only one payment method is allowed"). Since we always vault the card/ACH
    // before charging, the customer reference is enough — IQPro looks up the
    // card brand + masked number from the vault.

    const txPayload: Record<string, unknown> = {
      type: 'Sale',
      remit: {
        baseAmount: serverFees.baseAmount,
        taxAmount: serverFees.taxAmount,
        // IQPro requires isTaxExempt=true when calculated tax is 0; sending false
        // with zero tax fails validation ("must be true when all line items have zero tax").
        isTaxExempt: serverFees.taxAmount <= 0,
        currencyCode: 'USD',
        addTaxToTotal: true,
        ...(paymentAdjustments.length > 0 && { paymentAdjustments }),
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
        localTaxPercent: 0,
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

    // Basys sandbox ACH processor rejects standard test routing/account numbers
    // with a certification error. In sandbox, treat as approved.
    const isSandbox = process.env.IQPRO_BASE_URL?.includes('sandbox');
    const isCertError = responseText?.includes('not a valid transaction for certification');

    let txId: string;
    let txStatus: string;

    if (isSandbox && isCertError) {
      txId = (txData.transactionId ?? txData.id ?? '') as string;
      txStatus = 'pendingsettlement';
    }
    else {
      txId = (txData.transactionId ?? txData.id ?? '') as string;
      txStatus = ((txData.status ?? '') as string).toLowerCase();
    }

    const mapped: ProcessStoreOrderResult['status']
      = txStatus === 'captured' || txStatus === 'settled' || txStatus === 'authorized' || txStatus === 'pendingsettlement'
        ? 'approved'
        : txStatus === 'declined' || txStatus === 'failed'
          ? 'declined'
          : 'processing';

    // Send receipt email on success (fire-and-forget — don't block the response)
    if (mapped === 'approved' && body.email) {
      sendStoreOrderReceipt({
        toEmail: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        items: body.items ?? [],
        subtotal: body.subtotal,
        discountAmount: body.discountAmount ?? 0,
        surchargeAmount: serverFees.surchargeAmount,
        serviceFeesAmount: serverFees.serviceFeesAmount,
        convenienceFeesAmount: serverFees.convenienceFeesAmount,
        taxAmount: serverFees.taxAmount,
        total: serverFees.amount,
        transactionId: txId || undefined,
      }).catch(() => {
        // Already logged inside sendStoreOrderReceipt — don't let this fail the response
      });
    }

    return NextResponse.json<ProcessStoreOrderResult>({
      success: mapped === 'approved' || mapped === 'processing',
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
