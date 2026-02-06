# Dojo Kiosk - Claude Context

## Project Overview

**Dojo Kiosk** is a touch-optimized companion application to Dojo Planner for martial arts dojo self-service operations - handling member check-ins, free trials, membership signups, and store purchases on public kiosk terminals.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS + XState + Drizzle ORM + PostgreSQL + Clerk Auth + Stripe

## Kiosk User Flows

### Primary Flows
- **Free Trial (Adult/Youth)** - Age-appropriate waiver flows with legal compliance
- **Member Check-In (Phone Number)** - Phone-based lookup with family member support
- **Membership Signup (No Trial)** - Direct membership enrollment with payment
- **Member Self-Service** - Account info, billing, invoices, receipts

### Secondary Flows
- **Store Purchases** - Catalog items marked for kiosk display
- **Event Registration** - Seminar and workshop signups

## State Management (XState)

**Framework:** XState with @xstate/react for complex kiosk flows

**Key Machines:**
- `kioskMachine.ts` - Main session management with idle timeout
- `checkInMachine.ts` - Member check-in flow
- `trialMachine.ts` - Free trial signup (adult/youth branching)
- `membershipMachine.ts` - Direct membership signup
- `storeMachine.ts` - Catalog purchase flow

**Security States:**
```typescript
const kioskMachine = createMachine({
  id: 'kiosk',
  initial: 'idle',
  context: {
    idleTimer: 60000, // 60 seconds
    sessionTimer: 300000, // 5 minutes max
  },
  states: {
    idle: {
      on: {
        START_CHECK_IN: 'phoneEntry',
        START_TRIAL: 'ageSelection',
        START_MEMBERSHIP: 'membershipFlow',
        IDLE_TIMEOUT: 'autoReset'
      }
    },
    // ... other states
  }
});
```

## Shared Libraries Strategy

### Option 1: Direct File Copying
Copy essential files from main Dojo Planner app:

**Core Services** (copy to `src/shared/services/`):
```
/dojo-planner/src/services/MembersService.ts
/dojo-planner/src/services/ClassesService.ts
/dojo-planner/src/services/CatalogService.ts
/dojo-planner/src/services/BillingService.ts
/dojo-planner/src/services/AuditService.ts
```

**Database & Types** (copy to `src/shared/`):
```
/dojo-planner/src/models/Schema.ts
/dojo-planner/src/libs/DB.ts
/dojo-planner/src/libs/Stripe.ts
/dojo-planner/src/types/Auth.ts
/dojo-planner/src/types/Audit.ts
```

**Utilities** (copy to `src/shared/libs/`):
```
/dojo-planner/src/libs/Env.ts
/dojo-planner/src/libs/Logger.ts
/dojo-planner/src/libs/RateLimit.ts
```

### Option 2: Git Submodule (Recommended)
```bash
# In kiosk project root
git submodule add ../dojo-planner shared/dojo-planner
```

**Benefits:**
- Automatic sync with main app changes
- Maintains single source of truth
- Version control for shared code

**Usage:**
```typescript
import { auditLogger } from '@/shared/dojo-planner/src/libs/Logger';
// Import from submodule
import { MembersService } from '@/shared/dojo-planner/src/services/MembersService';
```

### Option 3: Monorepo with Shared Packages
Move both projects to a monorepo structure:
```
dojo-workspace/
├── apps/
│   ├── planner/     # Main admin app
│   └── kiosk/       # Kiosk app
├── packages/
│   ├── shared/      # Shared utilities
│   ├── database/    # Schema and migrations
│   └── ui/          # Shared components
```

## API Endpoints for Kiosk

### Member Operations
```typescript
// Member lookup and authentication
POST /api/members/lookup-by-phone
GET  /api/members/{id}
GET  /api/members/{id}/family
POST /api/members/{id}/check-in
GET  /api/members/{id}/billing-history

// Member registration
POST /api/members/create
POST /api/members/{id}/trial-signup
```

### Class Operations
```typescript
// Class schedules and check-ins
GET  /api/classes/schedule?date={date}
GET  /api/classes/{id}/instances
POST /api/classes/{instanceId}/check-in
GET  /api/classes/{instanceId}/capacity
```

### Catalog Operations
```typescript
// Kiosk store functionality
GET  /api/catalog/kiosk-items
GET  /api/catalog/items/{id}
POST /api/catalog/purchase
GET  /api/catalog/categories?kiosk=true
```

### Billing Operations
```typescript
// Stripe integration
POST / api / billing / create - checkout - session;
POST / api / billing / membership - signup;
GET / api / billing / plans;
POST / api / webhook / stripe;
```

### Event Operations
```typescript
// Event registration
GET / api / events / upcoming;
POST / api / events / { id } / register;
GET / api / events / { id } / sessions;
```

## Database Schema (Shared)

**Key Tables for Kiosk:**
- `member` - Member records with optional `clerkUserId`
- `catalog_item` - Products with `showOnKiosk` flag
- `class_schedule_instance` - Class sessions for check-in
- `attendance` - Check-in/out tracking
- `membership_plan` - Pricing tiers
- `transaction` - Payment records
- `audit_log` - SOC2 compliance logging

## Security & Compliance

### Rate Limiting (Public Terminal)
```typescript
const kioskRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1m'), // 20 requests per minute
  analytics: true,
  prefix: 'kiosk',
});
```

### Audit Logging (SOC2)
```typescript
// All kiosk actions must be audited
import { audit, AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@/shared/services/AuditService';

await audit(context, AUDIT_ACTION.MEMBER_CHECK_IN, AUDIT_ENTITY_TYPE.MEMBER, {
  entityId: memberId,
  source: 'kiosk',
  kioskId: process.env.KIOSK_ID,
  metadata: { method: 'phone_lookup' }
});
```

### Session Security
```typescript
// Auto-logout for public terminals
const KIOSK_IDLE_TIMEOUT = 60000; // 1 minute
const KIOSK_SESSION_TIMEOUT = 300000; // 5 minutes max

// Clear all session data on timeout
const resetKioskSession = () => {
  // Clear local storage
  localStorage.clear();
  // Reset state machines
  kioskService.send('RESET');
  // Navigate to home
  router.push('/');
};
```

## Touch-Optimized UI Components

### Base Components
```typescript
// Large touch targets for kiosk use
const KioskButton = ({ children, size = "lg", ...props }) => (
  <Button
    className={cn(
      "min-h-16 text-xl font-semibold touch-manipulation",
      "hover:scale-105 active:scale-95 transition-transform",
      size === "xl" && "min-h-20 text-2xl"
    )}
    {...props}
  >
    {children}
  </Button>
);

const PhoneKeypad = ({ onDigit, onDelete, onSubmit }) => (
  <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
    {[1,2,3,4,5,6,7,8,9,'*',0,'#'].map(digit => (
      <KioskButton
        key={digit}
        onClick={() => onDigit(digit)}
        className="aspect-square"
      >
        {digit}
      </KioskButton>
    ))}
  </div>
);
```

### Error Handling
```typescript
// Clear error states for public terminals
const KioskErrorBoundary = ({ children }) => (
  <ErrorBoundary
    fallback={
      <div className="text-center py-8">
        <AlertTriangle className="mx-auto h-16 w-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
        <KioskButton onClick={() => window.location.reload()}>
          Start Over
        </KioskButton>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
);
```

## Environment Variables

```bash
# Shared with main Dojo Planner app
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Kiosk-specific
NEXT_PUBLIC_KIOSK_ID=kiosk-001
NEXT_PUBLIC_KIOSK_LOCATION="Main Lobby"
NEXT_PUBLIC_IDLE_TIMEOUT=60000
NEXT_PUBLIC_SESSION_TIMEOUT=300000

# Rate limiting (optional)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Monitoring
NEXT_PUBLIC_SENTRY_DSN=...
NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN=...
```

## Deployment Considerations

### Kiosk Mode Browser
```typescript
// Disable browser features for kiosk mode
const kioskModeConfig = {
  kiosk: true,
  fullscreen: true,
  navigationDisabled: true,
  contextMenu: false,
  devTools: false,
  zoom: false,
  printing: false,
  downloads: false
};
```

### Hardware Requirements
- Touch screen (minimum 15" recommended)
- Network connectivity (wired preferred for stability)
- Webcam for QR codes (optional future feature)
- Receipt printer integration (future enhancement)

### Offline Capability (Future)
```typescript
// Cache member data for offline check-ins
const offlineCache = {
  members: [], // Essential member data
  classes: [], // Today's class schedule
  actions: [] // Queue offline actions
};
```

This architecture provides a secure, compliant, and user-friendly kiosk experience while leveraging the existing Dojo Planner infrastructure and maintaining consistency across both applications.
