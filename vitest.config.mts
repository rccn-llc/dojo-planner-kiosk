import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  optimizeDeps: {
    include: ['next-intl', '@mui/material', '@xstate/react', 'next/link'],
  },
  test: {
    silent: true,
    coverage: {
      include: ['src/**/*'],
      exclude: [
        'src/**/*.stories.{js,jsx,ts,tsx}',
        'src/shared/**/*', // Exclude shared code from coverage
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{js,ts}'],
          exclude: ['src/hooks/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    env: {
      ...loadEnv('', process.cwd(), ''),
      NODE_ENV: 'test',
    },
  },
});
