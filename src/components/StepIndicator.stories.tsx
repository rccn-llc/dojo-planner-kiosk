import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StepIndicator } from './StepIndicator';

const meta = {
  title: 'Kiosk/StepIndicator',
  component: StepIndicator,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Progress indicator used in multi-step flows (Trial, Membership). Filled dots represent completed or current steps.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    current: {
      control: { type: 'number', min: 0, max: 10 },
      description: '0-based index of the current step',
    },
    total: {
      control: { type: 'number', min: 1, max: 10 },
      description: 'Total number of steps',
    },
  },
} satisfies Meta<typeof StepIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Step1of3: Story = {
  args: { current: 0, total: 3 },
};

export const Step2of3: Story = {
  args: { current: 1, total: 3 },
};

export const Step3of3: Story = {
  args: { current: 2, total: 3 },
};

export const FiveSteps: Story = {
  args: { current: 2, total: 5 },
};
