// Vitest browser setup for UI testing
import { beforeAll } from 'vitest';

beforeAll(() => {
  // Mock environment variables for browser tests
  Object.assign(process.env, {
    NODE_ENV: 'test',
    NEXT_PUBLIC_SENTRY_DISABLED: 'true',
  });

  // Mock window methods that might be used in kiosk environment
  Object.assign(window, {
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // Mock IntersectionObserver for components that might use it
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
  } as any;

  // Mock ResizeObserver for responsive components
  global.ResizeObserver = class ResizeObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
  } as any;
});
