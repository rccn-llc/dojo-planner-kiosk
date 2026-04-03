import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { KioskFlowHeader } from './KioskFlowHeader';

const meta = {
  title: 'Kiosk/KioskFlowHeader',
  component: KioskFlowHeader,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Black header bar used at the top of every kiosk flow. Contains a back button, centered title, and an optional right-side slot (defaults to a spacer to keep the title centered).',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    onBack: { control: false },
    rightSlot: { control: false },
  },
} satisfies Meta<typeof KioskFlowHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Member Check-in',
    onBack: () => {},
  },
};

export const FreeTrial: Story = {
  args: {
    title: 'Start Your Free Trial',
    onBack: () => {},
  },
};

export const Membership: Story = {
  args: {
    title: 'Select Your Program',
    onBack: () => {},
  },
};

/** The Store flow passes a cart button into the right slot. */
export const WithCartButton: Story = {
  args: {
    title: 'Browse Products',
    onBack: () => {},
    rightSlot: (
      <button
        type="button"
        className="flex items-center gap-2 rounded-full border-2 border-white px-5 py-2 text-lg font-bold text-white transition-colors hover:bg-white hover:text-black"
      >
        <ShoppingCartIcon sx={{ fontSize: 24 }} />
        Cart
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-bold text-black">
          3
        </span>
      </button>
    ),
  },
};
