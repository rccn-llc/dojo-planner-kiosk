[![CI](https://github.com/rccn-llc/dojo-planner-kiosk/actions/workflows/CI.yml/badge.svg)](https://github.com/rccn-llc/dojo-planner-kiosk/actions/workflows/CI.yml)

# Dojo Kiosk

A touch-optimized companion application to Dojo Planner for martial arts dojo self-service operations. Handles member check-ins, free trials, membership signups, and member account access on public kiosk terminals.

## Features

### Primary Flows
- **Member Check-In** - Phone number-based lookup for existing members
- **Free Trial Signup** - Contact info collection and program selection with age-appropriate waivers
- **Membership Signup** - Direct membership enrollment with payment processing
- **Member Area** - Account dashboard showing family memberships and billing (login: phone + password)

### Security & UX
- **Auto-logout**: 60-second idle timeout for public terminals
- **Session management**: Proper cleanup between users
- **Touch optimization**: Large targets (min-h-16) and clear error states
- **Audit logging**: SOC2 compliant action tracking

## Tech Stack

- **Framework**: Next.js 16 (App Router) with Turbopack
- **Language**: TypeScript with strict configuration
- **State Management**: XState 5.0 for complex user flows
- **Styling**: Tailwind CSS with touch-optimized components
- **UI Components**: Material UI Icons (@mui/icons-material)
- **Database**: Shared PostgreSQL with Dojo Planner via Drizzle ORM
- **Authentication**: Clerk (shared with main app)
- **Payments**: Stripe integration for memberships

## State Management with XState

This application uses XState 5.0 to manage complex multi-step kiosk flows. Each flow (check-in, trial, membership, member area) is implemented as a separate state machine.

### Example: Member Area State Machine

The `memberAreaMachine` demonstrates a typical XState flow with multiple states and transitions:

```typescript
// Current Flow: Login → Dashboard (mocked authentication)
// Future Flow: Login → Program Selection → Plan Selection → Info Collection → Payment

states: {
  selectingProgram: {
    // Initial state - member login screen
    // 🔒 MOCKED: Authentication happens here via phone + password
    //    In production, this would call Clerk/API for real auth
    entry: assign(() => ({
      sessionId: generateSessionId(),
      errors: {} as Record<string, string>,
    })),

    on: {
      SELECT_PROGRAM: {
        // After successful login, transition to dashboard
        target: 'selectingPlan',
        actions: assign({
          selectedProgram: ({ event }) => event.program,
        }),
      },
      RESET: 'selectingProgram',
    },
  },

  selectingPlan: {
    // Shows member dashboard with family memberships
    // Displays John Smith and Emma Smith membership cards
    // Includes Account/Billing tabs, View Waiver, Hold, Cancel buttons
    on: {
      SELECT_PLAN: {
        target: 'reviewingCommitment',
        actions: assign({
          selectedPlan: ({ event }) => event.plan,
        }),
      },
      BACK: 'selectingProgram',
      RESET: 'selectingProgram',
    },
  },

  // Additional states for future upgrade flows
  reviewingCommitment: { /* ... */ },
  collectingInfo: { /* ... */ },
  validatingInfo: { /* ... */ },
  success: { /* ... */ },
  timeout: { /* ... */ },
}
```

**Key XState Concepts Used:**
- **States**: Each screen/step is a state (selectingProgram, selectingPlan, etc.)
- **Transitions**: Events trigger state changes (SELECT_PROGRAM, BACK, RESET)
- **Actions**: Side effects using `assign()` to update context
- **Guards**: Conditional logic to validate transitions
- **Entry/Exit Actions**: Run code when entering/leaving states
- **After**: Delayed transitions for timeouts and auto-redirects

**Mocked Services:**
- `loadPrograms()`: Returns hardcoded program list (Adult BJJ, Kids BJJ, Muay Thai, Judo)
- `loadMembershipPlans()`: Returns hardcoded plans (Monthly $159, Annual $99)
- Member authentication in `selectingProgram` state (no API call yet)
- Member data in dashboard (John Smith, Emma Smith hardcoded)

See `src/machines/memberAreaMachine.ts` for complete implementation.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
├── components/
│   ├── flows/             # Flow components (CheckinFlow, TrialFlow, etc.)
│   └── KioskHome.tsx      # Main kiosk home screen
├── machines/              # XState state machines
│   ├── checkinMachine.ts
│   ├── trialMachine.ts
│   ├── membershipMachine.ts
│   ├── memberAreaMachine.ts
│   └── types.ts           # Shared context/event types
├── hooks/
│   └── useKioskMachines.ts # React hooks for XState machines
├── services/
│   └── audit.ts           # Audit logging service
└── lib/
    ├── types.ts           # Kiosk type definitions
    └── utils.ts           # Phone formatting, validation
```

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- IQPro payment API credentials (for payment processing)

### Development Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
# Configure shared database, Clerk, and Stripe settings
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) with your browser.

### Current Implementation Status

✅ **Implemented:**
- All four main flows (Check-in, Trial, Membership, Member Area)
- XState 5.0 state machines for each flow
- Phone number masking and validation
- Material UI icons for navigation
- Touch-optimized UI with proper cursor states
- Audit logging structure
- Auto-logout and session management

🚧 **In Progress:**
- API integration for member lookup
- Stripe payment processing
- Real authentication (currently mocked)
- Database persistence


## Deployment

The kiosk application is designed for deployment on dedicated kiosk hardware with:
- Touch screen interface (15" minimum recommended)
- Kiosk mode browser configuration
- Network connectivity (wired preferred)
- Auto-restart capabilities

## Documentation

- `claude.md` - Complete technical documentation and architecture decisions
- `.github/copilot-instructions.md` - Development guidelines for AI assistance

## Contributing

This project follows the main Dojo Planner development standards:
- TypeScript strict mode
- Tailwind CSS for styling
- XState for complex state management
- Comprehensive error handling and user feedback
