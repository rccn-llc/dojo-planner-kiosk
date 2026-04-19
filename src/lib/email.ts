import type { Buffer } from 'node:buffer';
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
  discountAmount: number;
  surchargeAmount: number;
  serviceFeesAmount: number;
  convenienceFeesAmount: number;
  taxAmount: number;
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

// ── Membership confirmation email ────────────────────────────────────────────

interface MembershipConfirmationParams {
  toEmail: string;
  firstName: string;
  lastName: string;
  programName: string;
  planName: string;
  planPrice: number;
  planFrequency: string;
  planContractLength?: string;
  waiverPdfBuffer?: Buffer;
  waiverPdfFilename?: string;
  feeBreakdown?: {
    baseAmount: number;
    surchargeAmount: number;
    serviceFeesAmount: number;
    convenienceFeesAmount: number;
    taxAmount: number;
    amount: number;
  };
  isRecurring?: boolean;
}

export async function sendMembershipConfirmation(params: MembershipConfirmationParams): Promise<boolean> {
  if (!resend) {
    console.warn('[Email] Membership confirmation skipped — RESEND_API_KEY not configured');
    return false;
  }

  try {
    const priceStr = params.planPrice === 0 ? 'Free' : `$${params.planPrice.toFixed(2)}`;
    const frequencyStr = params.planFrequency === 'None' ? '' : ` / ${params.planFrequency.toLowerCase()}`;
    const fb = params.feeBreakdown;
    const dueTodayBlock = fb
      ? `
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Due Today</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 2px 0; color: #374151; font-size: 14px;">Base</td>
                  <td style="padding: 2px 0; color: #374151; font-size: 14px; text-align: right;">${formatCurrency(fb.baseAmount)}</td>
                </tr>
                ${feeRow('Surcharge', fb.surchargeAmount)}
                ${feeRow('Service fee', fb.serviceFeesAmount)}
                ${feeRow('Convenience fee', fb.convenienceFeesAmount)}
                ${feeRow('Tax', fb.taxAmount)}
                <tr>
                  <td style="padding: 8px 0 0; color: #111827; font-size: 18px; font-weight: 700; border-top: 2px solid #111827;">Total</td>
                  <td style="padding: 8px 0 0; color: #111827; font-size: 18px; font-weight: 700; text-align: right; border-top: 2px solid #111827;">${formatCurrency(fb.amount)}</td>
                </tr>
              </table>
              ${params.isRecurring
                ? `<p style="margin: 12px 0 0; color: #9ca3af; font-size: 12px;">Future billing cycles will include applicable fees and tax at that time's rate.</p>`
                : ''}
            </td>
          </tr>`
      : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="padding: 40px 32px;">

        <h1 style="margin: 0 0 4px; font-size: 24px; color: #111827;">Welcome to the Team!</h1>
        <p style="margin: 0 0 32px; color: #6b7280; font-size: 16px;">
          Hi ${params.firstName}, your membership is now active.
        </p>

        <!-- Membership details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="padding: 16px; background-color: #f9fafb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Program</p>
              <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${params.programName}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Plan</p>
              <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${params.planName}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Amount</p>
              <p style="margin: 0; color: #111827; font-size: 20px; font-weight: 700;">${priceStr}${frequencyStr}</p>
            </td>
          </tr>
          ${params.planContractLength
            ? `
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Contract</p>
              <p style="margin: 0; color: #111827; font-size: 16px;">${params.planContractLength}</p>
            </td>
          </tr>`
            : ''}
          ${dueTodayBlock}
        </table>

        ${params.waiverPdfBuffer ? '<p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">Your signed waiver is attached to this email as a PDF.</p>' : ''}

        <!-- Footer -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 24px 0 0; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
              <p style="margin: 0;">This is an automated confirmation. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

    const attachments: Array<{ filename: string; content: Buffer }> = [];
    if (params.waiverPdfBuffer && params.waiverPdfFilename) {
      attachments.push({
        filename: params.waiverPdfFilename,
        content: params.waiverPdfBuffer,
      });
    }

    await resend.emails.send({
      from: fromEmail,
      to: params.toEmail,
      subject: 'Your membership is active!',
      html,
      ...(attachments.length > 0 && { attachments }),
    });

    console.warn('[Email] Membership confirmation sent', {
      to: params.toEmail,
      hasWaiver: !!params.waiverPdfBuffer,
    });
    return true;
  }
  catch (error) {
    console.error('[Email] Failed to send membership confirmation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      to: params.toEmail,
    });
    return false;
  }
}

// ── Trial confirmation email ─────────────────────────────────────────────────

interface TrialConfirmationParams {
  toEmail: string;
  firstName: string;
  lastName: string;
  programName: string;
  planName: string;
  childNames?: string[];
  waiverPdfBuffer?: Buffer;
  waiverPdfFilename?: string;
}

export async function sendTrialConfirmation(params: TrialConfirmationParams): Promise<boolean> {
  if (!resend) {
    console.warn('[Email] Trial confirmation skipped — RESEND_API_KEY not configured');
    return false;
  }

  try {
    const hasChildren = params.childNames && params.childNames.length > 0;
    const childrenRow = hasChildren
      ? `
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Participants</p>
              <p style="margin: 0; color: #111827; font-size: 16px;">${params.childNames!.join(', ')}</p>
            </td>
          </tr>`
      : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="padding: 40px 32px;">

        <h1 style="margin: 0 0 4px; font-size: 24px; color: #111827;">Welcome!</h1>
        <p style="margin: 0 0 32px; color: #6b7280; font-size: 16px;">
          Hi ${params.firstName}, your free trial is confirmed.
        </p>

        <!-- Trial details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="padding: 16px; background-color: #f9fafb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Program</p>
              <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${params.programName}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Plan</p>
              <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${params.planName}</p>
            </td>
          </tr>
          ${childrenRow}
        </table>

        ${params.waiverPdfBuffer ? '<p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">Your signed waiver is attached to this email as a PDF.</p>' : ''}

        <p style="margin: 0 0 24px; color: #374151; font-size: 15px; line-height: 1.6;">
          We look forward to seeing you at the dojo. Stop by anytime during your trial to get started.
        </p>

        <!-- Footer -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 24px 0 0; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
              <p style="margin: 0;">This is an automated confirmation. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

    const attachments: Array<{ filename: string; content: Buffer }> = [];
    if (params.waiverPdfBuffer && params.waiverPdfFilename) {
      attachments.push({
        filename: params.waiverPdfFilename,
        content: params.waiverPdfBuffer,
      });
    }

    await resend.emails.send({
      from: fromEmail,
      to: params.toEmail,
      subject: 'Your free trial is confirmed!',
      html,
      ...(attachments.length > 0 && { attachments }),
    });

    console.warn('[Email] Trial confirmation sent', {
      to: params.toEmail,
      hasWaiver: !!params.waiverPdfBuffer,
    });
    return true;
  }
  catch (error) {
    console.error('[Email] Failed to send trial confirmation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      to: params.toEmail,
    });
    return false;
  }
}

// ── Cancellation confirmation email ──────────────────────────────────────────

interface CancellationConfirmationParams {
  toEmail: string;
  firstName: string;
  lastName: string;
  planName: string;
  cancelledAt: Date;
  cancellationFee?: number;
  cancellationTxId?: string;
}

export async function sendCancellationConfirmation(params: CancellationConfirmationParams): Promise<boolean> {
  if (!resend) {
    console.warn('[Email] Cancellation confirmation skipped — RESEND_API_KEY not configured');
    return false;
  }

  try {
    const dateStr = params.cancelledAt.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const feeRow = params.cancellationFee && params.cancellationFee > 0
      ? `
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Cancellation Fee</p>
              <p style="margin: 0; color: #111827; font-size: 20px; font-weight: 700;">$${params.cancellationFee.toFixed(2)}</p>
              ${params.cancellationTxId ? `<p style="margin: 4px 0 0; color: #9ca3af; font-size: 12px;">Transaction: ${params.cancellationTxId}</p>` : ''}
            </td>
          </tr>`
      : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="padding: 40px 32px;">

        <h1 style="margin: 0 0 4px; font-size: 24px; color: #111827;">Membership Cancelled</h1>
        <p style="margin: 0 0 32px; color: #6b7280; font-size: 16px;">
          Hi ${params.firstName}, your membership has been cancelled.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="padding: 16px; background-color: #f9fafb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Plan</p>
              <p style="margin: 0; color: #111827; font-size: 16px; font-weight: 600;">${params.planName}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase;">Cancelled On</p>
              <p style="margin: 0; color: #111827; font-size: 16px;">${dateStr}</p>
            </td>
          </tr>
          ${feeRow}
        </table>

        ${params.cancellationFee && params.cancellationFee > 0
          ? '<p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">A cancellation fee has been charged to your payment method on file.</p>'
          : ''}

        <p style="margin: 0 0 24px; color: #374151; font-size: 15px; line-height: 1.6;">
          If you have any questions about your cancellation, please contact the front desk.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 24px 0 0; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
              <p style="margin: 0;">This is an automated confirmation. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

    await resend.emails.send({
      from: fromEmail,
      to: params.toEmail,
      subject: 'Your membership has been cancelled',
      html,
    });

    console.warn('[Email] Cancellation confirmation sent', {
      to: params.toEmail,
      hasFee: !!params.cancellationFee,
    });
    return true;
  }
  catch (error) {
    console.error('[Email] Failed to send cancellation confirmation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      to: params.toEmail,
    });
    return false;
  }
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function feeRow(label: string, amount: number): string {
  if (!amount || amount <= 0) {
    return '';
  }
  return `<tr>
    <td colspan="2" style="padding: 4px 0; color: #6b7280; font-size: 14px;">${label}</td>
    <td style="padding: 4px 0; color: #6b7280; font-size: 14px; text-align: right;">${formatCurrency(amount)}</td>
  </tr>`;
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
          ${discountRow}
          ${feeRow('Surcharge', params.surchargeAmount)}
          ${feeRow('Service fee', params.serviceFeesAmount)}
          ${feeRow('Convenience fee', params.convenienceFeesAmount)}
          ${feeRow('Tax', params.taxAmount)}
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
