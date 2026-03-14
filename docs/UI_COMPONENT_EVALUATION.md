# UI Component Library Evaluation: Material-UI vs Radix UI

## Executive Summary

After analyzing both codebases, I recommend **keeping Material-UI in the kiosk app** while sharing Radix UI patterns where possible. The kiosk's touch interface requirements justify different UI choices than the main administrative app.

## Current State Analysis

### Kiosk App (Material-UI + Custom)
- **Primary UI**: Custom Tailwind CSS components with kiosk-specific optimizations
- **Icons**: @mui/icons-material for consistent iconography
- **Touch Targets**: min-h-16, min-h-20 for buttons (44-80px)
- **Typography**: text-2xl, text-4xl for readability (24px, 48px)
- **Spacing**: p-12, rounded-3xl for generous touch areas
- **Borders**: border-2 (2px) for high contrast visibility

### Main App (Radix UI + shadcn/ui)
- **Primary UI**: Complete Radix UI ecosystem via shadcn/ui
- **Components**: Button, Dialog, Select, Checkbox, etc.
- **Touch Targets**: h-9 default (36px) suitable for mouse/trackpad
- **Typography**: Standard body text for desktop readability
- **Design System**: Consistent with web application patterns

## Component Comparison Matrix

| Component | Kiosk (Touch-Optimized) | Main App (Desktop-First) | Recommendation |
|-----------|-------------------------|---------------------------|----------------|
| **Button** | Custom: min-h-16, text-2xl, py-4 | Radix: h-9, text-body, py-2 | Keep separate: Touch requirements different |
| **Dialog** | Not heavily used | Radix Dialog primitives | Could share: Low touch interaction |
| **Input** | Custom: text-xl, p-4, border-2 | Radix: Standard sizing | Keep separate: Touch typing needs |
| **Typography** | text-4xl headers, text-2xl body | Consistent scale | Could align: Create shared scale |
| **Icons** | @mui/icons-material | lucide-react | Consider shared: Same iconography |

## Touch Interface Requirements (WCAG 2.1 Level AA)

### Minimum Touch Targets
- **Current Kiosk**: 64px+ (min-h-16) ✅
- **Main App**: 36px (h-9) - Acceptable for desktop ✅
- **Requirement**: 44px minimum for touch interfaces

### Visual Accessibility
- **Current Kiosk**: High contrast, bold borders ✅
- **Main App**: Subtle shadows, refined borders ✅
- **Requirement**: Different contrast needs for kiosk environment

## Recommended Strategy: Hybrid Approach

### 1. Keep Material-UI Icons in Kiosk
```tsx
// Maintain for consistent iconography
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
```

### 2. Share Radix UI Primitives Where Appropriate
```tsx
// Low-touch components can be shared
import * as Dialog from '@radix-ui/react-dialog';
```

### 3. Create Touch-Optimized Variants
```tsx
// Extend main app components with touch variants
const Button = ({ variant, size, touch, ...props }) => {
  const touchClasses = touch ? 'min-h-16 text-2xl py-4' : 'h-9 py-2';
  // ...
};
```

### 4. Establish Shared Design Tokens
```typescript
// shared-design-tokens.ts
export const touchTargets = {
  kiosk: { minHeight: '64px', padding: '16px' },
  desktop: { minHeight: '36px', padding: '8px' }
};
```

## Implementation Plan

### Phase 1: Audit & Document (1 week)
- Document all kiosk touch requirements
- Create component usage inventory
- Define shared vs. specialized components

### Phase 2: Shared Infrastructure (1 week)
- Extract shared Radix primitives
- Create design token system
- Implement icon standardization

### Phase 3: Touch-Optimized Extensions (2 weeks)
- Create touch variants of core components
- Implement responsive touch targets
- Add accessibility testing

## Benefits of This Approach

### ✅ Advantages
- **Preserves kiosk touch optimization** without compromising usability
- **Reduces bundle size** by sharing primitives where possible
- **Maintains consistency** in iconography and design tokens
- **Future-proofs** both applications for their specific use cases

### ⚠️ Trade-offs
- **Additional complexity** in maintaining two button variants
- **Learning curve** for developers working across both apps
- **Bundle duplication** for some components (acceptable for different use cases)

## Technical Implementation

### Shared Component Structure
```
shared/
├── components/
│   ├── primitives/          # Shared Radix primitives
│   ├── tokens/              # Design system tokens
│   └── icons/               # Standardized icon system
├── kiosk/                   # Touch-optimized variants
└── desktop/                 # Desktop-optimized variants
```

### Touch-Responsive Button Example
```tsx
const buttonVariants = cva(base, {
  variants: {
    size: {
      default: 'h-9 px-4 py-2',
      touch: 'min-h-16 px-6 py-4 text-2xl' // Kiosk-specific
    }
  }
});
```

## Conclusion

The kiosk app's touch interface requirements justify maintaining Material-UI icons and custom touch-optimized components. However, we can achieve meaningful consistency by:

1. Sharing Radix UI primitives for low-touch components
2. Standardizing design tokens and iconography
3. Creating touch-responsive variants of core components

This hybrid approach optimizes each application for its specific use case while maximizing code reuse where appropriate.
