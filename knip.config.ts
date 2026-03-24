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
    // Peer dependencies loaded at runtime by MUI — not directly imported
    '@emotion/react',
    '@emotion/styled',
    // Used only in scripts (db-server, migrations) — not imported by source files
    'drizzle-kit',
    'pglite-server',
    // Dynamically imported at runtime — knip can't trace the variable-based import
    '@dojo-planner/iqpro-client',
    // Used via npx in CI release workflow — not imported by source files
    '@semantic-release/npm',
    'conventional-changelog-conventionalcommits',
  ],
  // Binaries invoked via npx in CI workflows — not installed as project deps
  ignoreBinaries: [
    'dotenv',
    'production',
    'checkly',
  ],
};

export default config;
