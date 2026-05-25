# IQPro `/transaction/calculatefees` returns 500 on card processors

## Summary

`POST /api/gateway/{gatewayId}/transaction/calculatefees` consistently returns
`500 InternalServerError` ("An Unexpected error has occured") when called
against either of our two card processors on the sandbox gateway. The same
endpoint returns clean structured `400`s with descriptive details when called
with invalid input, so validation works — the failure is downstream of
validation, somewhere in fee calculation or processor lookup.

The ACH processor on the same gateway accepts the call (reaches validation
cleanly), so OAuth, gateway routing, and the endpoint itself are functional.
The issue is specific to the card processors.

## Environment

- **Region:** Sandbox
- **Base URL:** `https://sandbox.api.basyspro.com/iqsaas/v1`
- **OAuth client ID:** `d62136aa-0ea6-490b-becb-f93eb25e85e5`
- **Gateway ID:** `e9a08998-e1d7-46bc-9e7b-38b8a3ded1fa`
- **Gateway name:** "Dojo Planner"
- **Merchant ID:** `434030057880`
- **Source reference:** `10338`

## Trace identifiers (most recent first)

All from `/calculatefees` 500s. Please share what your servers logged for each:

- `0HNLODFR44GFM:00000002`
- `0HNLODFR44GFM:00000003`
- `0HNLODFR44GFM:00000004`
- `0HNLODFR44GFL:00000003`
- `0HNLODFR44GFH:00000002`

## Reproducer

```http
POST /api/gateway/e9a08998-e1d7-46bc-9e7b-38b8a3ded1fa/transaction/calculatefees
Authorization: Bearer <token from OAuth client credentials with our standard scope>
Content-Type: application/json

{
  "baseAmount": 139.99,
  "addTaxToTotal": true,
  "taxAmount": 0,
  "processorId": "5e3d2c02-f603-40ca-9f6e-f642ddf623df",
  "transactionType": "Sale",
  "paymentAdjustments": [
    { "type": "ServiceFee", "percentage": 3.75, "flatAmount": null }
  ],
  "creditCardBin": "424242"
}
```

Response:

```json
{
  "statusCode": "InternalServerError",
  "statusDetails": [
    "TraceIdentifier: <one of the IDs above>",
    "An Unexpected error has occured, please refer to above traceID."
  ]
}
```

## Diagnostic sweep — variants we tried

We ran the call against every processor on the gateway, with several payload
variations, to isolate the failure:

| # | Variant                                                       | Processor                                                | Result |
| - | ------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| 1 | Body shown above                                              | `5e3d2c02…` (`fiserv_v12`, `isDefaultCard=true`)         | **500** |
| 2 | Drop `addTaxToTotal`                                          | same                                                     | **500** |
| 3 | `baseAmount: 100` (integer, no decimals)                      | same                                                     | **500** |
| 4 | Drop `paymentAdjustments` entirely                            | same                                                     | **500** |
| 5 | Send a TokenEx-style token instead of `creditCardBin`*        | same                                                     | clean 400 — "Raw card number may not be submitted. Submit a tokenized card number instead." |
| 6 | Use `flatAmount` instead of `percentage` on `ServiceFee`      | same                                                     | clean 400 — "ServiceFee must be expressed as a percentage" |
| 7 | Same body as #1                                               | `7da20571…` (`rapid_connect_basys_card_present`, Physical Terminal) | **500** |
| 8 | Same body as #1 with `processorId` swapped, `creditCardBin` removed | `b2ea8f54…` (`paya`, ACH, `isDefaultAch=true`)       | clean 400 — "Exactly one of Token/CreditCardBin must be provided" |

\* We sent a raw 16-digit number; we don't have a real TokenEx token handy
outside of a browser session. We will retry this once and report back if you
think it matters.

## Interpretation

- **OAuth and routing are fine:** every call returned through your validation
  layer, just with different responses based on the payload.
- **Validation works:** rows 5, 6, 8 returned structured 400s with clear
  `statusDetails` messages — exactly what we'd want to see.
- **Both card processors 500 on every valid-shaped payload** (rows 1, 2, 3, 4,
  7). The shape that triggers a 500 is the same shape that would reach actual
  fee computation if it weren't crashing.
- **ACH works** (row 8 reached validation cleanly), which strongly suggests
  the failure is specific to the card-processor fee-calc path on this
  gateway, not the endpoint itself or our credentials.

## Gateway dump (processors)

For reference, the gateway has four processors:

```json
[
  {
    "name": "Physical Terminal",
    "processorId": "7da20571-dcea-414f-9ea7-7d8dc0197f10",
    "processorType": { "name": "rapid_connect_basys_card_present", "type": "CreditCard", "certificationCategory": "PhysicalTerminal" },
    "merchantId": "434030057880",
    "isDefaultCard": false,
    "isDefaultAch": false
  },
  {
    "name": "ACH",
    "processorId": "b2ea8f54-b908-48b0-84e1-ae8a616878fa",
    "processorType": { "name": "paya", "type": "Ach", "certificationCategory": "VirtualTerminal" },
    "merchantId": "111111111111",
    "isDefaultCard": false,
    "isDefaultAch": false
  },
  {
    "name": "Cards",
    "processorId": "5e3d2c02-f603-40ca-9f6e-f642ddf623df",
    "processorType": { "name": "fiserv_v12", "type": "CreditCard", "certificationCategory": "VirtualTerminal" },
    "merchantId": "434030057880",
    "isDefaultCard": true,
    "isDefaultAch": false
  },
  {
    "name": "Kotapay ACH",
    "processorId": "bf687229-8be6-453d-8669-fc44dddb945b",
    "processorType": { "name": "kotapay_basys", "type": "Ach", "certificationCategory": "VirtualTerminal" },
    "merchantId": "434030057880",
    "isDefaultCard": false,
    "isDefaultAch": true
  }
]
```

## Questions

1. What did your servers log under the trace IDs above? The client-facing
   response only says "Unexpected error" — we need the actual stack or cause
   to know whether this is a configuration issue, a Fiserv-side error, or a
   bug in your service.
2. Is `/transaction/calculatefees` currently supported against `fiserv_v12`
   and `rapid_connect_basys_card_present` processor types on the sandbox? It
   works against the `paya` ACH processor when called correctly.
3. Is there a known incident, migration, or configuration step we're missing
   that's affecting `/calculatefees` for Fiserv-routed sandbox processors on
   this gateway?
4. If our payload shape is wrong for these processor types, what is the
   correct shape? It currently passes your validation layer (which returns
   clean structured 400s for bad input).

## Why we can't work around this locally

Service fee is currently a flat 3.75 % so the math is trivial to compute
locally, but we deliberately rely on `/calculatefees` as the single source of
truth so the amount we charge, display, and post to our reporting database
always matches what IQPro will assess. Computing locally would create drift
between our books and yours.

## Repro script

We have a self-contained Node script that runs the OAuth flow, fetches the
gateway, and executes the full diagnostic sweep above. Happy to share it
under NDA if helpful for reproducing on your end.

## Contact

- Application: Dojo Planner Kiosk
- Reporter: Mateo Nares — `mateo.nares@gmail.com`
