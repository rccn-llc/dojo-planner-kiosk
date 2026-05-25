/**
 * One-off debug script: hit IQPro directly with the kiosk's env config and
 * dump the gateway + a minimal /calculatefees call, so we can see what their
 * server is actually doing under the 500 we keep getting.
 *
 * Run: npx tsx src/scripts/debugIQProFees.ts
 */

import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

async function main(): Promise<void> {
  const clientId = process.env.IQPRO_CLIENT_ID!;
  const clientSecret = process.env.IQPRO_CLIENT_SECRET!;
  const scope = process.env.IQPRO_SCOPE!;
  const oauthUrl = process.env.IQPRO_OAUTH_URL!;
  const baseUrl = process.env.IQPRO_BASE_URL!;
  const gatewayId = process.env.IQPRO_GATEWAY_ID!;

  // 1. OAuth
  const tokRes = await fetch(oauthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });
  const tokJson = await tokRes.json() as { access_token: string };
  const token = tokJson.access_token;
  console.log('OAuth status:', tokRes.status, 'token len:', token?.length);

  // 2. Gateway info
  const gwRes = await fetch(`${baseUrl}/api/gateway/${gatewayId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const gwText = await gwRes.text();
  console.log('\n--- GET /api/gateway/{id} ---');
  console.log('status:', gwRes.status);
  console.log(gwText.slice(0, 4000));

  // Pull out processors
  let processors: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(gwText) as { data?: { processors?: Array<Record<string, unknown>> } };
    processors = parsed.data?.processors ?? [];
  }
  catch {
    console.log('(could not parse gateway response)');
  }
  console.log('\nProcessors:');
  for (const p of processors) {
    console.log('  -', JSON.stringify(p));
  }

  // 3. /calculatefees — exact body the kiosk sends
  const defaultCard = processors.find(p => p.isDefaultCard);
  const processorId = (defaultCard?.processorId as string | undefined) ?? 'unknown';
  const body = {
    baseAmount: 139.99,
    addTaxToTotal: true,
    taxAmount: 0,
    processorId,
    transactionType: 'Sale',
    paymentAdjustments: [
      { type: 'ServiceFee', percentage: 3.75, flatAmount: null },
    ],
    creditCardBin: '424242',
  };
  console.log('\n--- POST /transaction/calculatefees ---');
  console.log('body:', JSON.stringify(body));
  const feesRes = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const feesText = await feesRes.text();
  console.log('status:', feesRes.status);
  console.log(feesText);

  // 4. Variant: drop addTaxToTotal
  console.log('\n--- POST /transaction/calculatefees (no addTaxToTotal) ---');
  const body2 = { ...body } as Record<string, unknown>;
  delete body2.addTaxToTotal;
  const feesRes2 = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body2),
  });
  console.log('status:', feesRes2.status);
  console.log(await feesRes2.text());

  // 5. Variant: integer baseAmount instead of float
  console.log('\n--- POST /transaction/calculatefees (integer baseAmount) ---');
  const body3 = { ...body, baseAmount: 100 };
  const feesRes3 = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body3),
  });
  console.log('status:', feesRes3.status);
  console.log(await feesRes3.text());

  // 6. Variant: against the ACH processor (paya) instead of fiserv card
  const ach = processors.find(p => p.isDefaultAch);
  if (ach) {
    console.log('\n--- POST /transaction/calculatefees (ACH processor, paya) ---');
    const bodyAch = { ...body, processorId: ach.processorId as string };
    delete (bodyAch as Record<string, unknown>).creditCardBin;
    const feesResAch = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyAch),
    });
    console.log('status:', feesResAch.status);
    console.log(await feesResAch.text());
  }

  // 7. Variant: against the physical-terminal card processor
  const physTerm = processors.find(p => (p.name as string) === 'Physical Terminal');
  if (physTerm) {
    console.log('\n--- POST /transaction/calculatefees (Physical Terminal processor) ---');
    const bodyPt = { ...body, processorId: physTerm.processorId as string };
    const feesResPt = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPt),
    });
    console.log('status:', feesResPt.status);
    console.log(await feesResPt.text());
  }

  // 8. Variant: without paymentAdjustments at all — does the endpoint
  //    even respond 200 on a minimal call?
  console.log('\n--- POST /transaction/calculatefees (no paymentAdjustments) ---');
  const bodyMin = { ...body } as Record<string, unknown>;
  delete bodyMin.paymentAdjustments;
  const feesResMin = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyMin),
  });
  console.log('status:', feesResMin.status);
  console.log(await feesResMin.text());

  // 9b. Variant: card processor with a TokenEx-style token instead of BIN
  console.log('\n--- POST /transaction/calculatefees (token instead of BIN) ---');
  const bodyTok = { ...body } as Record<string, unknown>;
  delete bodyTok.creditCardBin;
  bodyTok.token = '4242424242424242';
  const feesResTok = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyTok),
  });
  console.log('status:', feesResTok.status);
  console.log(await feesResTok.text());

  // 9. Variant: ServiceFee with flatAmount instead of percentage
  console.log('\n--- POST /transaction/calculatefees (flatAmount ServiceFee) ---');
  const bodyFlat = {
    ...body,
    paymentAdjustments: [{ type: 'ServiceFee', percentage: null, flatAmount: 5.25 }],
  };
  const feesResFlat = await fetch(`${baseUrl}/api/gateway/${gatewayId}/transaction/calculatefees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyFlat),
  });
  console.log('status:', feesResFlat.status);
  console.log(await feesResFlat.text());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
