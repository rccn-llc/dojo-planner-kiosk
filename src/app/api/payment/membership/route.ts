import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { sendMembershipConfirmation } from '@/lib/email';
import { iqproPost, isIQProConfigured, tokenizeAch } from '@/lib/iqpro';
import {
  address,
  member,
  memberMembership,
  membershipPlan,
  signedWaiver,
  transaction,
  waiverTemplate,
} from '@/lib/memberSchema';
import { generatePdfFilename, generateWaiverPdfBuffer } from '@/lib/waiverPdf';

interface MembershipPaymentBody {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  paymentMethod: 'card' | 'ach';
  cardToken?: string;
  cardFirstSix?: string;
  cardLastFour?: string;
  cardExpiry?: string;
  cardholderName?: string;
  achAccountHolder?: string;
  achRoutingNumber?: string;
  achAccountNumber?: string;
  achAccountType?: 'Checking' | 'Savings';
  planId: string;
  planName: string;
  planPrice: number;
  planFrequency: string;
  planContractLength?: string;
  billingType: string;
  programName: string;
  dateOfBirth?: string;
  guardianFirstName?: string;
  guardianLastName?: string;
  guardianEmail?: string;
  guardianRelationship?: string;
  waiverSignature: string;
  signedByName: string;
  waiverContent: string;
  organizationName: string;
  organizationId: string;
}

function sanitizePhone(phone?: string): string | undefined {
  if (!phone) {
    return undefined;
  }
  const digits = phone.replace(/\D/g, '');
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return trimmed.slice(0, 10) || undefined;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as MembershipPaymentBody;
    const orgId = body.organizationId || process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ success: false, error: 'Organization context not available' }, { status: 500 });
    }

    const db = getDatabase();
    const gatewayId = process.env.IQPRO_GATEWAY_ID;
    const now = new Date();

    // Fetch the plan from the database
    const plans = await db
      .select()
      .from(membershipPlan)
      .where(eq(membershipPlan.id, body.planId))
      .limit(1);

    const plan = plans[0];
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Membership plan not found' }, { status: 404 });
    }

    // Create or find the member
    const memberId = randomUUID();
    const phone = sanitizePhone(body.phone);

    await db.insert(member).values({
      id: memberId,
      organizationId: orgId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: phone ?? null,
      memberType: 'individual',
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
      status: 'active',
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Create address
    const street = [body.address, body.addressLine2].filter(Boolean).join(' ');
    await db.insert(address).values({
      id: randomUUID(),
      memberId,
      type: 'home',
      street,
      city: body.city,
      state: body.state,
      zipCode: body.zip,
      country: 'US',
      isDefault: true,
    });

    // Create member membership
    const memberMembershipId = randomUUID();
    const isRecurring = body.billingType === 'autopay';

    await db.insert(memberMembership).values({
      id: memberMembershipId,
      memberId,
      membershipPlanId: body.planId,
      status: 'active',
      billingType: body.billingType,
      startDate: now,
      createdAt: now,
      updatedAt: now,
    });

    // Fetch waiver template for signed waiver record
    const waiverTemplates = await db
      .select()
      .from(waiverTemplate)
      .where(
        and(
          eq(waiverTemplate.organizationId, orgId),
          eq(waiverTemplate.isActive, true),
        ),
      )
      .orderBy(desc(waiverTemplate.version))
      .limit(1);

    const wt = waiverTemplates[0];

    // Create signed waiver
    const signedByRelationship = body.guardianRelationship ?? null;
    if (wt) {
      await db.insert(signedWaiver).values({
        id: randomUUID(),
        organizationId: orgId,
        waiverTemplateId: wt.id,
        waiverTemplateVersion: wt.version,
        memberId,
        memberMembershipId,
        membershipPlanName: plan.name,
        membershipPlanPrice: plan.price,
        membershipPlanFrequency: plan.frequency,
        membershipPlanContractLength: plan.contractLength,
        signatureDataUrl: body.waiverSignature,
        signedByName: body.signedByName,
        signedByEmail: body.guardianEmail ?? body.email,
        signedByRelationship,
        memberFirstName: body.firstName,
        memberLastName: body.lastName,
        memberEmail: body.email,
        memberDateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        renderedContent: body.waiverContent,
        signedAt: now,
        createdAt: now,
      });
    }

    // Process payment if plan has a price > 0 and IQPro is configured
    let paymentSuccess = true;
    let txId: string | undefined;

    if (plan.price > 0 && isIQProConfigured() && gatewayId) {
      try {
        // Create IQPro customer
        const customerRes = await iqproPost<{ data?: Record<string, unknown> }>(
          `/api/gateway/${gatewayId}/customer`,
          {
            name: `${body.firstName} ${body.lastName}`,
            referenceId: `kiosk_membership_${Date.now()}`,
            addresses: [
              {
                addressLine1: body.address,
                ...(body.addressLine2 && { addressLine2: body.addressLine2 }),
                city: body.city,
                state: body.state,
                postalCode: body.zip,
                country: 'US',
                firstName: body.firstName,
                lastName: body.lastName,
                email: body.email,
                ...(phone && { phone }),
                isBilling: true,
              },
            ],
          },
        );

        const customerData = customerRes.data ?? customerRes;
        const customerId = (customerData as Record<string, unknown>).customerId as string;

        // Register payment method
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
          paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? '') as string;
        }
        else {
          const tokenizeResult = await tokenizeAch({
            accountNumber: body.achAccountNumber!,
            routingNumber: body.achRoutingNumber!,
            secCode: 'WEB',
            achAccountType: body.achAccountType ?? 'Checking',
          });

          const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
            `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
            {
              ach: {
                token: tokenizeResult.achToken,
                secCode: 'WEB',
                routingNumber: body.achRoutingNumber,
                accountType: body.achAccountType ?? 'Checking',
              },
              isDefault: true,
            },
          );
          const pmData = (pmRes.data ?? pmRes) as Record<string, unknown>;
          paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? '') as string;
        }

        // Process transaction
        const amount = Math.round(plan.price * 100) / 100;

        if (isRecurring) {
          // Create subscription
          const subRes = await iqproPost<{ data?: Record<string, unknown> }>(
            `/api/gateway/${gatewayId}/subscription`,
            {
              customerId,
              customerPaymentMethodId: paymentMethodId,
              plan: {
                name: plan.name,
                amount,
                frequency: plan.frequency === 'Annual' ? 'yearly' : 'monthly',
                duration: 0,
              },
            },
          );
          const subData = (subRes.data ?? subRes) as Record<string, unknown>;
          txId = (subData.subscriptionId ?? subData.id ?? '') as string;

          // Update member membership with subscription ID
          await db.update(memberMembership)
            .set({ iqproSubscriptionId: txId })
            .where(eq(memberMembership.id, memberMembershipId));
        }
        else {
          // One-time charge
          const txRes = await iqproPost<{ data?: Record<string, unknown> }>(
            `/api/gateway/${gatewayId}/transaction`,
            {
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
                },
              },
            },
          );
          const txRaw = txRes.data ?? txRes;
          const txData = ((txRaw as Record<string, unknown>).transaction ?? txRaw) as Record<string, unknown>;
          txId = (txData.transactionId ?? txData.id ?? '') as string;
        }

        // Record transaction
        await db.insert(transaction).values({
          id: randomUUID(),
          organizationId: orgId,
          memberId,
          memberMembershipId,
          transactionType: 'membership_payment',
          amount: plan.price,
          status: 'paid',
          paymentMethod: body.paymentMethod,
          description: `${plan.name} membership`,
          iqproTransactionId: txId,
          processedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      catch (payErr) {
        console.error('[payment/membership] Payment error:', payErr);
        paymentSuccess = false;
      }
    }

    if (!paymentSuccess) {
      return NextResponse.json({
        success: false,
        status: 'declined',
        error: 'Payment processing failed. Please try again.',
      });
    }

    // Send confirmation email (fire-and-forget)
    if (body.email) {
      let pdfBuffer: Buffer | undefined;
      let pdfFilename: string | undefined;

      if (body.waiverSignature && body.waiverContent) {
        try {
          pdfBuffer = await generateWaiverPdfBuffer({
            memberFirstName: body.firstName,
            memberLastName: body.lastName,
            signedByName: body.signedByName,
            signedByRelationship,
            signedAt: now,
            waiverTemplateName: wt?.name ?? 'Membership Waiver',
            renderedContent: body.waiverContent,
            signatureDataUrl: body.waiverSignature,
            planName: plan.name,
            planPrice: plan.price,
            planFrequency: plan.frequency,
          });
          pdfFilename = generatePdfFilename(body.lastName, body.firstName);
        }
        catch (pdfErr) {
          console.error('[payment/membership] PDF generation error:', pdfErr);
        }
      }

      sendMembershipConfirmation({
        toEmail: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        programName: body.programName,
        planName: plan.name,
        planPrice: plan.price,
        planFrequency: plan.frequency,
        planContractLength: plan.contractLength,
        waiverPdfBuffer: pdfBuffer,
        waiverPdfFilename: pdfFilename,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      status: 'approved',
      memberId,
      memberMembershipId,
    });
  }
  catch (error) {
    console.error('[payment/membership] Error:', error);
    return NextResponse.json({
      success: false,
      status: 'declined',
      error: error instanceof Error ? error.message : 'Membership creation failed',
    });
  }
}
