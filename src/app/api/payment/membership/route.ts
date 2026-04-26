import type { Buffer } from 'node:buffer';
import type { FeeBreakdown } from '@/lib/types';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { sendMembershipConfirmation } from '@/lib/email';
import { assertTransactionApproved, buildServiceFeeAdjustment, computeFeeBreakdown, getGatewayProcessors, iqproGet, iqproPost, isIQProConfigured, tokenizeAch } from '@/lib/iqpro';
import {
  address,
  member,
  memberMembership,
  membershipPlan,
  membershipWaiver,
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
  country?: string;
  planId: string;
  planName: string;
  planPrice: number;
  planFrequency: string;
  planContractLength?: string;
  billingType: string;
  feeBreakdown: FeeBreakdown | null;
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
  couponCode?: string;
  couponDiscount?: number;
  existingMemberId?: string | null;
  convertingTrialMembershipId?: string | null;
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
      .select({
        id: membershipPlan.id,
        name: membershipPlan.name,
        price: membershipPlan.price,
        signupFee: membershipPlan.signupFee,
        frequency: membershipPlan.frequency,
        contractLength: membershipPlan.contractLength,
        isTrial: membershipPlan.isTrial,
      })
      .from(membershipPlan)
      .where(eq(membershipPlan.id, body.planId))
      .limit(1);

    const plan = plans[0];
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Membership plan not found' }, { status: 404 });
    }

    // Create or reuse the member
    const phone = sanitizePhone(body.phone);
    const memberId = body.existingMemberId ?? randomUUID();

    if (body.existingMemberId) {
      // Update existing member with any new info from the form
      await db.update(member)
        .set({
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: phone ?? null,
          dateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
          status: 'active',
          statusChangedAt: now,
          updatedAt: now,
        })
        .where(eq(member.id, body.existingMemberId));
    }
    else {
      await db.insert(member).values({
        id: memberId,
        organizationId: orgId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: phone ?? null,
        memberType: 'individual',
        dateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
        status: 'active',
        statusChangedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Create or update the default address
    const street = [body.address, body.addressLine2].filter(Boolean).join(' ');
    if (body.existingMemberId) {
      // Remove existing default address and insert a fresh one to avoid conflicts
      await db.delete(address).where(
        and(eq(address.memberId, body.existingMemberId), eq(address.isDefault, true)),
      );
    }
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

    // Look up waiver template via membershipWaiver junction table
    let wt: typeof waiverTemplate.$inferSelect | undefined;

    const linkedWaivers = await db
      .select({ waiverTemplateId: membershipWaiver.waiverTemplateId })
      .from(membershipWaiver)
      .where(eq(membershipWaiver.membershipPlanId, body.planId))
      .limit(1);

    if (linkedWaivers[0]) {
      const templates = await db
        .select()
        .from(waiverTemplate)
        .where(
          and(
            eq(waiverTemplate.id, linkedWaivers[0].waiverTemplateId),
            eq(waiverTemplate.isActive, true),
          ),
        )
        .orderBy(desc(waiverTemplate.version))
        .limit(1);

      wt = templates[0];
    }

    // Fallback: default active waiver template for the org
    if (!wt) {
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

      wt = waiverTemplates[0];
    }

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
        membershipPlanSignupFee: plan.signupFee,
        membershipPlanIsTrial: plan.isTrial,
        signatureDataUrl: body.waiverSignature,
        signedByName: body.signedByName,
        signedByEmail: body.guardianEmail ?? body.email,
        signedByRelationship,
        memberFirstName: body.firstName,
        memberLastName: body.lastName,
        memberEmail: body.email,
        memberDateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
        renderedContent: body.waiverContent,
        signedAt: now,
        createdAt: now,
      });
    }

    // Process payment if plan has a price > 0 and IQPro is configured
    let paymentSuccess = true;
    let paymentError: string | undefined;
    let txId: string | undefined;
    let chargedFees: Awaited<ReturnType<typeof computeFeeBreakdown>> | undefined;

    if (plan.price > 0 && isIQProConfigured() && gatewayId) {
      try {
        // Get gateway processor IDs for card/ACH
        const { cardProcessorId, achProcessorId } = await getGatewayProcessors();

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

        // Fetch customer details to get billing address ID
        const customerDetail = await iqproGet<{ data?: Record<string, unknown> }>(
          `/api/gateway/${gatewayId}/customer/${customerId}`,
        );
        const detailData = customerDetail.data ?? customerDetail;
        const addresses = ((detailData as Record<string, unknown>).addresses ?? []) as Array<Record<string, unknown>>;
        const custBillingAddr = addresses.find(a => a.isBilling) ?? addresses[0];
        const customerBillingAddressId = (custBillingAddr?.customerAddressId ?? custBillingAddr?.id ?? '') as string;

        // Update member with IQPro customer ID
        await db.update(member)
          .set({ iqproCustomerId: customerId })
          .where(eq(member.id, memberId));

        // Register payment method
        let paymentMethodId: string;
        let achToken: string | undefined;
        let achAccountType: 'Checking' | 'Savings' | undefined;

        if (body.paymentMethod === 'card') {
          // The client must have tokenized the card via TokenEx before calling
          // this endpoint — we never accept a raw PAN. Missing token/BIN/last-four
          // here means the tokenize step didn't run or was skipped; fail fast
          // rather than sending placeholder values that the gateway would reject.
          if (!body.cardToken || !body.cardFirstSix || !body.cardLastFour || !body.cardExpiry) {
            throw new Error('Card was not tokenized. Please re-enter your card.');
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
          paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? '') as string;
        }
        else {
          achAccountType = body.achAccountType ?? 'Checking';
          const tokenizeResult = await tokenizeAch({
            accountNumber: body.achAccountNumber!,
            routingNumber: body.achRoutingNumber!,
            secCode: 'WEB',
            achAccountType,
          });
          achToken = tokenizeResult.achToken;

          const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
            `/api/gateway/${gatewayId}/customer/${customerId}/payment`,
            {
              ach: {
                token: tokenizeResult.achToken,
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
          paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? '') as string;
        }

        // Calculate payment amount (apply coupon discount if any).
        // Memberships are NOT taxed — only the service fee applies.
        const baseAmount = Math.round(plan.price * 100) / 100;
        const discountAmount = body.couponDiscount ? Math.round(body.couponDiscount * 100) / 100 : 0;
        const discountedBase = Math.max(0, Math.round((baseAmount - discountAmount) * 100) / 100);

        const processorId = body.paymentMethod === 'card' ? cardProcessorId : achProcessorId;
        if (!processorId) {
          throw new Error(`No ${body.paymentMethod} processor configured`);
        }
        const serverFees = await computeFeeBreakdown(discountedBase, /* isTaxable */ false, {
          processorId,
          token: body.paymentMethod === 'card' ? body.cardToken : achToken,
          creditCardBin: body.paymentMethod === 'card' ? body.cardFirstSix : undefined,
        });

        if (body.feeBreakdown && Math.abs(serverFees.amount - body.feeBreakdown.amount) > 0.01) {
          console.error('[payment/membership] Fee mismatch — client:', body.feeBreakdown.amount, 'server:', serverFees.amount);
          throw new Error('Fee breakdown has changed — please refresh and try again');
        }

        // Service fee adjustment (applied to every transaction).
        const paymentAdjustments: Array<Record<string, unknown>> = [buildServiceFeeAdjustment(serverFees)];

        const amount = serverFees.amount;
        chargedFees = serverFees;

        // Build address objects for IQPro (used by both subscription and transaction)
        const country = body.country || 'US';
        const billingAddress = {
          isBilling: true,
          isShipping: false,
          isRemittance: false,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          state: body.state,
          country,
          ...(sanitizePhone(body.phone) && { phone: sanitizePhone(body.phone) }),
          addressLine1: body.address,
          ...(body.addressLine2 && { addressLine2: body.addressLine2 }),
          city: body.city,
          postalCode: body.zip,
        };
        const remittanceAddress = {
          isBilling: false,
          isShipping: false,
          isRemittance: true,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          country,
        };

        // Build the per-transaction paymentMethod block.
        // IQPro rejects any transaction that sends more than one of
        // card / ach / customer under paymentMethod ("Only one payment method
        // is allowed").
        // - CARD: paymentMethod.customer (pulls card details from the vault).
        // - ACH: paymentMethod.ach (inline per Basys ACH docs). We still vault
        //   ACH upstream for the customer record, but the charge uses the ACH
        //   sub-object rather than the vault reference.
        const buildTxPaymentMethod = (): Record<string, unknown> => {
          if (body.paymentMethod === 'ach' && achToken && achAccountType) {
            return {
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
          return {
            customer: {
              customerId,
              customerPaymentMethodId: paymentMethodId,
              ...(customerBillingAddressId && { customerBillingAddressId }),
            },
          };
        };

        const txRemit = {
          baseAmount: serverFees.baseAmount,
          taxAmount: serverFees.taxAmount,
          // IQPro requires isTaxExempt=true when calculated tax is 0.
          isTaxExempt: serverFees.taxAmount <= 0,
          currencyCode: 'USD',
          addTaxToTotal: true,
          ...(paymentAdjustments.length > 0 && { paymentAdjustments }),
        };

        const txAddress = [
          {
            isPhysical: true,
            isBilling: true,
            isShipping: false,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: sanitizePhone(body.phone) || null,
            addressLine1: body.address,
            addressLine2: body.addressLine2 || null,
            city: body.city,
            state: body.state,
            postalCode: body.zip,
            country,
          },
        ];

        const txLineItems = [
          {
            name: plan.name,
            description: `${plan.frequency} membership`,
            quantity: 1,
            unitPrice: baseAmount,
            discount: discountAmount,
            freightAmount: 0,
            unitOfMeasureId: 1,
            localTaxPercent: 0,
            nationalTaxPercent: 0,
          },
        ];

        if (isRecurring) {
          const billingPeriodId = plan.frequency === 'Annual' ? 6 : 4;
          const dayOfMonth = now.getDate();

          const schedule: Record<string, number[]> = {
            minutes: [0],
            hours: [0],
            daysOfMonth: [dayOfMonth],
          };
          if (plan.frequency === 'Annual') {
            schedule.monthsOfYear = [now.getMonth() + 1];
          }

          const subRes = await iqproPost<{ data?: Record<string, unknown> }>(
            `/api/gateway/${gatewayId}/subscription`,
            {
              customerId,
              subscriptionStatusId: 1,
              name: plan.name,
              prefix: 'MBR',
              recurrence: {
                termStartDate: now.toISOString(),
                billingStartDate: now.toISOString(),
                isAutoRenewed: true,
                allowProration: false,
                trialLengthInDays: 0,
                invoiceLengthInDays: 1,
                billingPeriodId,
                schedule,
              },
              paymentMethod: {
                customerPaymentMethodId: paymentMethodId,
                isAutoCharged: true,
                ...(cardProcessorId && { cardProcessorId }),
                ...(achProcessorId && { achProcessorId }),
              },
              addresses: [billingAddress, remittanceAddress],
              lineItems: [
                {
                  name: plan.name,
                  description: `${plan.frequency} membership payment`,
                  quantity: 1,
                  unitPrice: baseAmount,
                  discount: 0,
                  unitOfMeasureId: plan.frequency === 'Annual' ? 4 : 3,
                },
              ],
              ...(paymentAdjustments.length > 0 && { paymentAdjustments }),
            },
          );
          const subData = (subRes.data ?? subRes) as Record<string, unknown>;
          const subscriptionId = (subData.subscriptionId ?? subData.id ?? '') as string;

          await db.update(memberMembership)
            .set({ iqproSubscriptionId: subscriptionId })
            .where(eq(memberMembership.id, memberMembershipId));

          // IQPro subscriptions don't auto-charge on creation — process initial Sale
          if (amount > 0) {
            const initTxPayload: Record<string, unknown> = {
              type: 'Sale',
              remit: txRemit,
              paymentMethod: buildTxPaymentMethod(),
              address: txAddress,
              lineItems: txLineItems,
              caption: `Membership: ${plan.name}`.substring(0, 19),
            };

            const initTxRes = await iqproPost<{ data?: Record<string, unknown> }>(
              `/api/gateway/${gatewayId}/transaction`,
              initTxPayload,
            );
            const initTxRaw = initTxRes.data ?? initTxRes;
            const initTxData = ((initTxRaw as Record<string, unknown>).transaction ?? initTxRaw) as Record<string, unknown>;
            txId = (initTxData.transactionId ?? initTxData.id ?? '') as string;
            assertTransactionApproved(initTxData);
          }

          txId = txId ?? subscriptionId;
        }
        else {
          // One-time charge
          const txPayload: Record<string, unknown> = {
            type: 'Sale',
            remit: txRemit,
            paymentMethod: buildTxPaymentMethod(),
            address: txAddress,
            lineItems: txLineItems,
            caption: `Membership: ${plan.name}`.substring(0, 19),
          };

          const txRes = await iqproPost<{ data?: Record<string, unknown> }>(
            `/api/gateway/${gatewayId}/transaction`,
            txPayload,
          );
          const txRaw = txRes.data ?? txRes;
          const txData = ((txRaw as Record<string, unknown>).transaction ?? txRaw) as Record<string, unknown>;
          txId = (txData.transactionId ?? txData.id ?? '') as string;
          assertTransactionApproved(txData);
        }

        // Record transaction
        await db.insert(transaction).values({
          id: randomUUID(),
          organizationId: orgId,
          memberId,
          memberMembershipId,
          transactionType: 'membership_payment',
          amount: serverFees.amount,
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
        paymentError = payErr instanceof Error ? payErr.message : undefined;
      }
    }

    if (!paymentSuccess) {
      return NextResponse.json({
        success: false,
        status: 'declined',
        error: paymentError ?? 'Payment processing failed. Please try again.',
      });
    }

    // If converting a trial, cancel the trial membership now that payment succeeded
    if (body.convertingTrialMembershipId) {
      try {
        await db.update(memberMembership)
          .set({
            status: 'cancelled',
            endDate: now,
            updatedAt: now,
          })
          .where(eq(memberMembership.id, body.convertingTrialMembershipId));
      }
      catch (cancelErr) {
        console.error('[payment/membership] Failed to cancel trial membership:', cancelErr);
      }
    }

    // Generate waiver PDF (used for both emails)
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

    // Send confirmation email with waiver PDF attached (fire-and-forget)
    if (body.email) {
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
        feeBreakdown: chargedFees
          ? {
              baseAmount: chargedFees.baseAmount,
              taxAmount: chargedFees.taxAmount,
              taxPct: chargedFees.taxPct,
              serviceFeeAmount: chargedFees.serviceFeeAmount,
              serviceFeePct: chargedFees.serviceFeePct,
              amount: chargedFees.amount,
            }
          : undefined,
        isRecurring,
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
