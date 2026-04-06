import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { KioskSelect } from './KioskSelect';

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

const meta = {
  title: 'Kiosk/KioskSelect',
  component: KioskSelect,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Touch-optimized select dropdown with custom chevron icon. Used across membership, trial, and store flows for state selection, account type, and other form dropdowns.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: { control: 'text' },
    error: { control: 'text' },
    label: { control: 'text' },
    placeholder: { control: 'text' },
    required: { control: 'boolean' },
    onChange: { control: false },
    options: { control: false },
  },
  decorators: [
    Story => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KioskSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StateSelect: Story = {
  args: {
    id: 'state',
    value: '',
    label: 'State',
    required: true,
    placeholder: 'Select state…',
    options: US_STATES.map(s => ({ value: s, label: s })),
    onChange: () => {},
  },
};

export const WithValue: Story = {
  args: {
    id: 'state',
    value: 'CA',
    label: 'State',
    required: true,
    placeholder: 'Select state…',
    options: US_STATES.map(s => ({ value: s, label: s })),
    onChange: () => {},
  },
};

export const WithError: Story = {
  args: {
    id: 'state',
    value: '',
    label: 'State',
    required: true,
    placeholder: 'Select state…',
    error: 'State is required',
    options: US_STATES.map(s => ({ value: s, label: s })),
    onChange: () => {},
  },
};

export const AccountType: Story = {
  args: {
    id: 'accountType',
    value: 'Checking',
    label: 'Account Type',
    required: true,
    options: [
      { value: 'Checking', label: 'Checking' },
      { value: 'Savings', label: 'Savings' },
    ],
    onChange: () => {},
  },
};

export const GuardianRelationship: Story = {
  args: {
    id: 'relationship',
    value: 'parent',
    label: 'Relationship',
    options: [
      { value: 'parent', label: 'Parent' },
      { value: 'guardian', label: 'Guardian' },
      { value: 'legal_guardian', label: 'Legal Guardian' },
    ],
    onChange: () => {},
  },
};

function InteractiveDemo() {
  const [value, setValue] = useState('');
  return (
    <KioskSelect
      id="demo"
      value={value}
      onChange={setValue}
      label="State"
      required
      placeholder="Select state…"
      options={US_STATES.map(s => ({ value: s, label: s }))}
    />
  );
}

export const Interactive: Story = {
  args: {
    id: 'demo',
    value: '',
    options: [],
    onChange: () => {},
  },
  render: () => <InteractiveDemo />,
};
