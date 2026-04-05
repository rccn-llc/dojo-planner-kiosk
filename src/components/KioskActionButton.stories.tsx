import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KioskActionButton } from './KioskActionButton';

const meta = {
  title: 'Kiosk/KioskActionButton',
  component: KioskActionButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Large touch-optimized navigation button used on the kiosk home screen. Each button launches a specific flow.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    onClick: { control: false },
  },
} satisfies Meta<typeof KioskActionButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Free Trial',
    onClick: () => {},
  },
};

export const CheckIn: Story = {
  args: {
    label: 'Check In',
    onClick: () => {},
  },
};

export const Membership: Story = {
  args: {
    label: 'Membership',
    onClick: () => {},
  },
};

export const Store: Story = {
  args: {
    label: 'Store',
    onClick: () => {},
  },
};

export const MembersArea: Story = {
  args: {
    label: 'Members Area',
    onClick: () => {},
  },
};

/** All five home screen buttons rendered together as they appear in the grid. */
export const AllButtons: Story = {
  args: {
    label: 'Free Trial',
    onClick: () => {},
  },
  render: () => (
    <div className="grid w-175 grid-cols-3 gap-6">
      {['Free Trial', 'Membership', 'Check In', 'Members Area', 'Store'].map(label => (
        <KioskActionButton key={label} label={label} onClick={() => {}} />
      ))}
    </div>
  ),
};
