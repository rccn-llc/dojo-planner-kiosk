import antfu from '@antfu/eslint-config';

import jsxA11y from 'eslint-plugin-jsx-a11y';
// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import tailwind from 'eslint-plugin-tailwindcss';

export default antfu(
  {
    react: true,
    nextjs: true,
    typescript: true,

    // Configuration preferences
    lessOpinionated: true,
    isInEditor: false,

    // Code style
    stylistic: {
      semi: true,
    },

    // Format settings
    formatters: {
      css: true,
    },

    // Ignored paths
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'shared/**',
      '*.md',
      'docs/**',
    ],
  },
  // --- Accessibility Rules ---
  jsxA11y.flatConfigs.recommended,
  // --- Tailwind CSS Rules (manual configuration for v4 compatibility) ---
  {
    plugins: {
      tailwindcss: tailwind,
    },
    rules: {
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',
      'tailwindcss/enforces-shorthand': 'warn',
      'tailwindcss/migration-from-tailwind-2': 'warn',
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/no-contradicting-classname': 'error',
      'tailwindcss/no-custom-classname': 'off', // Allow custom classes for kiosk
      'tailwindcss/no-unnecessary-arbitrary-value': 'warn',
    },
    settings: {
      tailwindcss: {
        // Disable config loading for v4 compatibility
        config: false,
        callees: ['clsx', 'cn', 'tw'],
        classRegex: '^class(Name)?$',
      },
    },
  },
  {
    rules: {
      // Kiosk-specific rule adjustments
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      'react/prefer-destructuring-assignment': 'off',
      // Temporary workarounds for strict TypeScript
      '@typescript-eslint/no-unused-vars': 'warn',
      // Allow process.env (Node.js global) — same pattern as dojo-planner
      'node/prefer-global/process': 'off',
      // XState-driven effects legitimately call setState — not an infinite loop risk
      'react-hooks-extra/no-direct-set-state-in-use-effect': 'off',
    },
  },
);
