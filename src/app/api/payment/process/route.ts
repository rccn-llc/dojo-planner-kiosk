import { NextResponse } from 'next/server';
import { sendStoreOrderReceipt } from '@/lib/email';
import { getIQProClient, isIQProConfigured, tokenizeAch } from '@/lib/iqpro';

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
 * Processes a one-time store order payment via IQPro.
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

  const client = await getIQProClient();
  if (!client) {
    return NextResponse.json<ProcessStoreOrderResult>(
      { success: false, status: 'declined', error: 'Payment client unavailable' },
      { status: 503 },
    );
  }

  try {
    // ── Step 1: Create customer ───────────────────────────────────────────────
    const customer = await client.customers.create({
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
    });

    const customerId = customer.customerId;

    // ── Step 2: Register payment method ──────────────────────────────────────
    let paymentMethodId: string;
    let achData: { achToken: string; secCode: string; routingNumber: string; accountType: string } | undefined;

    if (body.paymentMethod === 'card') {
      const first6 = body.cardFirstSix ?? '000000';
      const last4 = body.cardLastFour ?? '0000';
      const maskedCard = `${first6}******${last4}`;

      // API expects: { card: { token, expirationDate: "MM/YY", maskedCard }, isDefault }
      const pm = await client.customers.createPaymentMethod(customerId, {
        card: {
          token: body.cardToken,
          expirationDate: body.cardExpiry ?? '',
          maskedCard,
        },
        isDefault: true,
      } as unknown as Parameters<typeof client.customers.createPaymentMethod>[1]);

      const raw = pm as unknown as Record<string, unknown>;
      paymentMethodId = (raw.customerPaymentMethodId as string | undefined) ?? pm.paymentMethodId ?? pm.customerPaymentId ?? '';
    }
    else {
      // ACH: tokenize server-side first
      const { achToken } = await tokenizeAch({
        accountNumber: body.achAccountNumber!,
        routingNumber: body.achRoutingNumber!,
        secCode: 'WEB',
        achAccountType: body.achAccountType ?? 'Checking',
      });

      const pm = await client.customers.createPaymentMethod(customerId, {
        ach: {
          token: achToken,
          secCode: 'WEB',
          routingNumber: body.achRoutingNumber,
          accountType: body.achAccountType ?? 'Checking',
          checkNumber: null,
          accountHolderAuth: { dlState: null, dlNumber: null },
        },
        isDefault: true,
      } as unknown as Parameters<typeof client.customers.createPaymentMethod>[1]);

      const rawAch = pm as unknown as Record<string, unknown>;
      paymentMethodId = (rawAch.customerPaymentMethodId as string | undefined) ?? pm.paymentMethodId ?? pm.customerPaymentId ?? '';
      achData = {
        achToken,
        secCode: 'WEB',
        routingNumber: body.achRoutingNumber!,
        accountType: body.achAccountType ?? 'Checking',
      };
    }

    // ── Step 3: Process one-time charge ──────────────────────────────────────
    let tx: { id: string; status?: string; processorResponseMessage?: string };

    if (body.paymentMethod === 'ach' && achData) {
      // ACH: bypass SDK, call API directly (SDK strips ach field)
      const gatewayId = process.env.IQPRO_GATEWAY_ID;
      if (!gatewayId) {
        throw new Error('IQPRO_GATEWAY_ID is required for ACH transaction');
      }

      const response = await client.post<Record<string, unknown>>(
        `/api/gateway/${gatewayId}/transaction`,
        {
          type: 'Sale',
          remit: {
            baseAmount: body.amount,
            totalAmount: body.amount,
            currencyCode: 'USD',
          },
          paymentMethod: {
            customer: {
              customerId,
              customerPaymentMethodId: paymentMethodId,
            },
          },
          ach: {
            achToken: achData.achToken,
            secCode: 'WEB',
            routingNumber: achData.routingNumber,
            accountType: achData.accountType,
            checkNumber: null,
            accountHolderAuth: { dlState: null, dlNumber: null },
          },
          ...(body.description && { caption: body.description.substring(0, 19) }),
        },
      );

      const data = (response.data ?? response) as Record<string, unknown>;
      const txData = (data.transaction ?? data) as Record<string, unknown>;
      tx = {
        id: (txData.transactionId ?? txData.id ?? '') as string,
        status: (txData.status ?? '') as string,
        processorResponseMessage: txData.processorResponseMessage as string | undefined,
      };
    }
    else {
      // Card: use SDK
      const amountCents = Math.round(body.amount * 100);
      tx = await client.transactions.create({
        customerId,
        amount: amountCents,
        currency: 'USD',
        description: body.description,
        Remit: { totalAmount: amountCents },
        paymentMethod: {
          customer: {
            customerId,
            customerPaymentMethodId: paymentMethodId,
          },
        },
      });
    }

    const statusStr = typeof tx.status === 'string' ? tx.status.toLowerCase() : '';
    const mapped: ProcessStoreOrderResult['status']
      = statusStr === 'captured' || statusStr === 'settled' || statusStr === 'authorized' || statusStr === 'pendingsettlement'
        ? 'approved'
        : statusStr === 'declined' || statusStr === 'failed'
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
        transactionId: tx.id || undefined,
      }).catch(() => {
        // Already logged inside sendStoreOrderReceipt — don't let this fail the response
      });
    }

    return NextResponse.json<ProcessStoreOrderResult>({
      success: mapped === 'approved',
      status: mapped,
      transactionId: tx.id,
      declineReason: tx.processorResponseMessage,
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
