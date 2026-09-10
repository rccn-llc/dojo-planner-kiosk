/**
 * Provider-authoritative fee quote for Square orgs.
 *
 * Mirrors `SquarePaymentProvider.computeFees` in dojo-planner. Both tax and
 * service fee come back from `POST /v2/orders/calculate` — Square computes the
 * money from the rates we supply, so nothing here does arithmetic on it. That
 * is the standing rule for this codebase: every figure displayed, persisted or
 * reported must be the value the provider returned.
 *
 * Sandbox-verified for a $100 line item at 8.375% tax and a 3.75% service
 * charge: tax 838, service charge 375, total 11213 — i.e. tax applies to the
 * SUBTOTAL only and does NOT include the service charge. A service charge
 * comes back `taxable: false` unless `applied_taxes` names the tax explicitly,
 * which is the behaviour we want: the service fee is our platform fee, not a
 * taxable good.
 */

import type { SquareServerConfig } from './iqproConfig';
import type { FeeBreakdown } from './types';
import { fromMinorUnits, squarePost, toMinorUnits } from './square';

interface CalculateOrderResponse {
  order?: {
    total_money?: { amount?: number };
    total_tax_money?: { amount?: number };
    total_service_charge_money?: { amount?: number };
  };
}

export async function computeSquareFeeBreakdown(
  config: SquareServerConfig,
  params: {
    baseAmount: number;
    isTaxable: boolean;
    taxStatePct: number;
    serviceFeePct: number;
  },
): Promise<FeeBreakdown> {
  const body = {
    order: {
      location_id: config.locationId,
      line_items: [
        {
          name: 'Purchase',
          quantity: '1',
          base_price_money: { amount: toMinorUnits(params.baseAmount), currency: 'USD' },
        },
      ],
      ...(params.isTaxable && params.taxStatePct > 0
        ? {
            taxes: [
              {
                uid: 'tax',
                name: 'Sales tax',
                percentage: String(params.taxStatePct),
                scope: 'ORDER',
              },
            ],
          }
        : {}),
      service_charges: [
        {
          uid: 'service-fee',
          name: 'Service fee',
          percentage: String(params.serviceFeePct),
          calculation_phase: 'SUBTOTAL_PHASE',
        },
      ],
    },
  };

  const res = await squarePost<CalculateOrderResponse>(config, '/v2/orders/calculate', body);

  const totalMinor = res.order?.total_money?.amount;
  if (totalMinor === undefined) {
    throw new Error('Square calculated an order but returned no total.');
  }

  return {
    baseAmount: params.baseAmount,
    taxAmount: fromMinorUnits(res.order?.total_tax_money?.amount ?? 0),
    taxPct: params.isTaxable ? params.taxStatePct : 0,
    serviceFeeAmount: fromMinorUnits(res.order?.total_service_charge_money?.amount ?? 0),
    serviceFeePct: params.serviceFeePct,
    amount: fromMinorUnits(totalMinor),
  };
}
