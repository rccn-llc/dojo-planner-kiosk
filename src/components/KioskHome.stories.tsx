import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KioskHome } from './KioskHome';

const meta: Meta<typeof KioskHome> = {
  title: 'Kiosk/Home Screen',
  component: KioskHome,
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
    },
  },
  // Mock the /api/organization fetch used in KioskHome
  beforeEach() {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/organization')) {
        return new Response(JSON.stringify({ name: 'Demo Martial Arts' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The default home screen as a visitor would first see it. */
export const Default: Story = {};

/** Shows the loading state when org name hasn't resolved yet (network slow). */
export const OrgNameLoading: Story = {
  beforeEach() {
    // fetch never resolves — simulates a slow network
    globalThis.fetch = () => new Promise(() => {});
  },
};
