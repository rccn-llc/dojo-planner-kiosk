# Dojo Kiosk Application - Copilot Instructions

## Project Overview
This is a Next.js 16 TypeScript kiosk application for martial arts dojo member check-ins, free trials, and membership signup. Built as a companion to the main Dojo Planner application.

## Development Guidelines

### Architecture
- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript with strict configuration
- **State Management**: XState for complex user flows
- **Styling**: Tailwind CSS with touch-optimized components
- **Database**: Shared PostgreSQL with main app via Drizzle ORM
- **Authentication**: Clerk (shared with main app)
- **Payments**: Stripe integration for memberships

### UI/UX Principles
- Large touch targets (min-h-16) for kiosk use
- High contrast colors and clear typography
- Simple navigation patterns suitable for public terminals
- Auto-logout and session management for security
- Error states with clear recovery paths

### Security Requirements
- Idle timeout (60 seconds) with auto-reset
- Session cleanup between users
- Audit logging for all actions (SOC2 compliance)
- Rate limiting for public terminal access
- Phone number-based authentication

### Code Patterns
- Use XState machines for complex flows (check-in, signup, trial)
- Follow existing patterns from main Dojo Planner app
- Implement proper error boundaries and loading states
- Include comprehensive audit logging
- Use shared services from main application

### Testing
- Unit tests for components and hooks
- Integration tests for state machines
- E2E tests for complete user flows
- Touch/mobile-friendly test scenarios
