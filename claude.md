# Dojo Kiosk - Claude Context

## Project Overview

**Dojo Kiosk** is a touch-optimized companion application to Dojo Planner for martial arts dojo self-service operations — handling member check-ins, free trials, membership signups, and store purchases on public kiosk terminals.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + XState 5 + Drizzle ORM + PostgreSQL + MUI Icons

**Font:** Inter (via `next/font/google`), matching the dojo-planner app.

**Shared code:** Kiosk-specific types and utilities live in `src/lib/types.ts` and `src/lib/utils.ts`. No submodule or external dependency on dojo-planner at runtime.

## Kiosk User Flows

Each flow is a standalone component in `src/components/flows/` backed by an XState machine in `src/machines/`:

| Flow | Component | Machine | Description |
|------|-----------|---------|-------------|
| Free Trial | `TrialFlow.tsx` | `trialMachine.ts` | Adult/youth branching, parent info, waiver, signature |
| Check-In | `CheckinFlow.tsx` | `checkinMachine.ts` | Phone lookup, confirm, upgrade path |
| Membership | `MembershipFlow.tsx` | `membershipMachine.ts` | Program → plan → commitment → contact info |
| Members Area | `MemberAreaFlow.tsx` | `memberAreaMachine.ts` | Phone+password login, account/billing dashboard |
| Store | `StoreFlow.tsx` | `storeMachine.ts` | Browse → product detail → cart → checkout → payment |

The home screen (`KioskHome.tsx`) orchestrates flow selection and displays the Clerk organization name fetched from `/api/organization`.

## API Endpoints (Implemented)

```
GET  /api/catalog              - Fetch kiosk-visible catalog items (filtered by ORGANIZATION_ID)
GET  /api/organization         - Fetch Clerk org name via Backend API
GET  /api/payment/tokenization-config - IQPro TokenEx iframe config for card entry
POST /api/payment/process      - Process store order (create customer → payment method → charge)
```

## Payment Processing (IQPro)

Payments are processed via direct IQPro REST API calls — **no SDK dependency** at runtime. The `@dojo-planner/iqpro-client` package is listed in dependencies but its `dist/` is not built; all payment logic uses `iqproPost`/`iqproGet` helpers in `src/lib/iqpro.ts` that make authenticated calls using OAuth client credentials.

**Flow:** OAuth token → create customer → register payment method (card token or ACH token) → process transaction.

**Card payments:** TokenEx iframe tokenizes card data client-side. The token is captured before leaving the checkout screen and passed to the server.

**ACH payments:** Account number tokenized server-side via IQPro Vault API, then registered as a payment method.

**Key files:**
- `src/lib/iqpro.ts` — OAuth token management, tokenization config, ACH tokenization, API helpers
- `src/app/api/payment/process/route.ts` — Full payment processing endpoint
- `src/hooks/useTokenExIframe.ts` — Client-side TokenEx iframe management

## Store Flow Details

- **Single-variant products** auto-select the variant and show it as text (no dropdown)
- **Multi-variant products** show a dropdown selector
- **Cart** has a centered "Continue Shopping" button (bag icon) above the cart grid
- **Checkout** validates all buyer fields (name, email, phone, address, city, state, zip) AND payment fields before enabling "Place order"
- **Order success** shows a 60-second countdown with a circular progress ring before auto-returning home

## Responsive Design

All components use mobile-first responsive Tailwind classes following dojo-planner patterns:
- `sm:` (640px) — tablet adjustments
- `md:` (768px) — desktop kiosk
- `lg:` (1024px) — wide layouts (checkout/cart grids switch from stacked to 5-col)

Grids collapse from multi-column to single-column on small viewports. Headers, cards, buttons, and text all scale down.

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# Organization (required — identifies which org's data to show)
ORGANIZATION_ID=org_...
NEXT_PUBLIC_ORGANIZATION_ID=org_...

# Clerk (for org name display on home screen)
CLERK_SECRET_KEY=sk_...

# IQPro Payment Processing (all required for payments to work)
IQPRO_CLIENT_ID=...
IQPRO_CLIENT_SECRET=...
IQPRO_SCOPE=...
IQPRO_OAUTH_URL=...
IQPRO_BASE_URL=...          # e.g. https://sandbox.api.basyspro.com/iqsaas/v1
IQPRO_GATEWAY_ID=...

# Email (for receipt sending)
RESEND_API_KEY=...
```

## State Management (XState 5)

Each flow uses `@xstate/react` hooks via `src/hooks/useKioskMachines.ts`. Machines define:
- States for each step of the flow
- Guards for validation (e.g., `isCheckoutValid`)
- `assign` actions for form field updates
- Timeout states for session security

## Key Architecture Decisions

- **No Clerk auth for kiosk users** — the kiosk is a public terminal. Clerk is only used server-side to fetch org metadata.
- **No IQPro SDK at runtime** — all payment API calls are made directly via fetch with OAuth tokens, avoiding the missing `dist/` build issue.
- **Favicon** matches dojo-planner (SVG + PNG variants + apple-touch-icon in `public/`).
- **Touch-optimized** — large buttons (min-h-14+), rounded corners (rounded-2xl/3xl), scale transitions on hover.
