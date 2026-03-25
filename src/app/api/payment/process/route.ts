import { NextResponse } from 'next/server';
import { sendStoreOrderReceipt } from '@/lib/email';
import { iqproGet, iqproPost, isIQProConfigured, tokenizeAch } from '@/lib/iqpro';

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

  // Order
  amount: number; // total in dollars (includes admin fee, minus discount)
  subtotal: number; // pre-fee subtotal
  adminFee: number;
  discountAmount: number;
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
    let achTxData: { achToken: string; accountType: string; routingNumber: string } | undefined;

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
      achTxData = { achToken, accountType, routingNumber: body.achRoutingNumber! };
    }

    // ── Step 3: Process one-time charge ──────────────────────────────────────
    const amount = Math.round(body.amount * 100) / 100;

    const txPayload: Record<string, unknown> = {
      type: 'Sale',
      remit: {
        baseAmount: amount,
        totalAmount: amount,
        currencyCode: 'USD',
      },
      paymentMethod: {
        customer: {
          customerId,
          customerPaymentMethodId: paymentMethodId,
          ...(customerBillingAddressId && { customerBillingAddressId }),
        },
      },
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
      ...(body.description && { caption: body.description.substring(0, 19) }),
    };

    // ACH transactions require the ach object in the payload
    if (body.paymentMethod === 'ach' && achTxData) {
      txPayload.ach = {
        achToken: achTxData.achToken,
        secCode: 'WEB',
        routingNumber: achTxData.routingNumber,
        accountType: achTxData.accountType,
        checkNumber: null,
        accountHolderAuth: { dlState: null, dlNumber: null },
      };
    }

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
        subtotal: body.subtotal ?? body.amount,
        adminFee: body.adminFee ?? 0,
        discountAmount: body.discountAmount ?? 0,
        total: body.amount,
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
