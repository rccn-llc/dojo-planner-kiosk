import type { Preview } from '@storybook/nextjs-vite';
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    viewport: {
      defaultViewport: 'kiosk',
      viewports: {
        kiosk: {
          name: 'Kiosk (1280×800)',
          styles: { width: '1280px', height: '800px' },
          type: 'desktop',
        },
        kioskTall: {
          name: 'Kiosk Tall (1080×1920)',
          styles: { width: '1080px', height: '1920px' },
          type: 'desktop',
        },
        tablet: {
          name: 'Tablet (768×1024)',
          styles: { width: '768px', height: '1024px' },
          type: 'tablet',
        },
      },
    },
    backgrounds: {
      default: 'white',
      values: [
        { name: 'white', value: '#ffffff' },
        { name: 'dark', value: '#0a0a0a' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
};

export default preview;
