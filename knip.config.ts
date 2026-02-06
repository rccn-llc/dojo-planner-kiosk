import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Files to exclude from Knip analysis
  ignore: [
    'src/shared/**', // Shared code with main app
    'vitest.browser.setup.ts', // Knip false positive with vitest setupFiles
    'vitest.config.mts', // Knip false positive with vitest setupFiles
    'playwright.config.ts', // Configuration file
    'tailwind.config.ts', // Configuration file
  ],
  // Dependencies to ignore during analysis
  ignoreDependencies: [
    '@commitlint/types',
    '@swc/helpers',
    'vite',
    // Kiosk-specific dependencies that may not be directly imported
    '@xstate/react',
    '@mui/material',
    '@emotion/react',
    '@emotion/styled',
  ],
  // Binaries to ignore during analysis
  ignoreBinaries: ['next', 'playwright', 'vitest'],
};

export default config;
