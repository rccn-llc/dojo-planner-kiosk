import { Resend } from 'resend';

// Lazily initialized — only if RESEND_API_KEY is set
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@dojoplanner.com';

interface StoreOrderReceiptParams {
  toEmail: string;
  firstName: string;
  lastName: string;
  items: Array<{
    productName: string;
    variantName?: string;
    quantity: number;
    price: number;
  }>;
  subtotal: number;
  adminFee: number;
  discountAmount: number;
  total: number;
  transactionId?: string;
}

/**
 * Send an order receipt email after a successful store purchase.
 * Fails silently — logs but does not throw if Resend is not configured.
 */
export async function sendStoreOrderReceipt(params: StoreOrderReceiptParams): Promise<boolean> {
  if (!resend) {
    console.warn('[Email] Receipt skipped — RESEND_API_KEY not configured');
    return false;
  }

  try {
    const html = buildReceiptHtml(params);

    await resend.emails.send({
      from: fromEmail,
      to: params.toEmail,
      subject: 'Your order receipt',
      html,
    });

    console.warn('[Email] Order receipt sent', { to: params.toEmail, transactionId: params.transactionId });
    return true;
  }
  catch (error) {
    console.error('[Email] Failed to send order receipt', {
      error: error instanceof Error ? error.message : 'Unknown error',
      to: params.toEmail,
    });
    return false;
  }
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function buildReceiptHtml(params: StoreOrderReceiptParams): string {
  const itemRows = params.items.map(item => `
    <tr>
      <td style="padding: 8px 0; color: #374151; border-bottom: 1px solid #f3f4f6;">
        ${item.productName}${item.variantName ? ` — ${item.variantName}` : ''}
      </td>
      <td style="padding: 8px 0; color: #374151; border-bottom: 1px solid #f3f4f6; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 8px 0; color: #374151; border-bottom: 1px solid #f3f4f6; text-align: right;">
        ${formatCurrency(item.price * item.quantity)}
      </td>
    </tr>`).join('');

  const discountRow = params.discountAmount > 0
    ? `<tr>
        <td colspan="2" style="padding: 4px 0; color: #16a34a;">Discount</td>
        <td style="padding: 4px 0; color: #16a34a; text-align: right;">-${formatCurrency(params.discountAmount)}</td>
      </tr>`
    : '';

  const transactionNote = params.transactionId
    ? `<p style="margin: 0 0 4px; color: #9ca3af; font-size: 12px;">Transaction ID: ${params.transactionId}</p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="padding: 40px 32px;">

        <h1 style="margin: 0 0 4px; font-size: 24px; color: #111827;">Order Confirmed</h1>
        <p style="margin: 0 0 32px; color: #6b7280; font-size: 16px;">
          Thanks, ${params.firstName}! Here's your receipt.
        </p>

        <!-- Item table -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="padding: 0 0 8px; text-align: left; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Item</th>
              <th style="padding: 0 0 8px; text-align: center; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Qty</th>
              <th style="padding: 0 0 8px; text-align: right; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <!-- Totals -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
          <tr>
            <td colspan="2" style="padding: 4px 0; color: #374151;">Subtotal</td>
            <td style="padding: 4px 0; color: #374151; text-align: right;">${formatCurrency(params.subtotal)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 4px 0; color: #6b7280; font-size: 14px;">Admin fee (4.75%)</td>
            <td style="padding: 4px 0; color: #6b7280; font-size: 14px; text-align: right;">${formatCurrency(params.adminFee)}</td>
          </tr>
          ${discountRow}
          <tr>
            <td colspan="2" style="padding: 12px 0 0; color: #111827; font-size: 18px; font-weight: 700; border-top: 2px solid #111827;">Total</td>
            <td style="padding: 12px 0 0; color: #111827; font-size: 18px; font-weight: 700; text-align: right; border-top: 2px solid #111827;">${formatCurrency(params.total)}</td>
          </tr>
        </table>

        <!-- Footer -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 24px 0 0; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
              ${transactionNote}
              <p style="margin: 0;">This is an automated receipt. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
