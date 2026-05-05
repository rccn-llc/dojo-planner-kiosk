'use client';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface KioskSelectOption {
  value: string;
  label: string;
}

interface KioskSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: KioskSelectOption[];
  placeholder?: string;
  error?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

export function KioskSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  error,
  label,
  required,
  disabled,
}: KioskSelectProps) {
  return (
    <div>
      {label && (
        <label
          htmlFor={id}
          className="mb-2 block text-lg font-semibold text-black"
        >
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`w-full appearance-none rounded-xl border-2 bg-white p-4 pr-10 text-xl text-black placeholder:text-gray-400 focus:border-gray-600 focus:ring-4 focus:ring-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${
            error ? 'border-red-400 focus:border-red-500 focus:ring-red-300' : 'border-gray-300'
          }`}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500">
          <ExpandMoreIcon sx={{ fontSize: 24 }} />
        </span>
      </div>
      {error && <p className="mt-1 text-base text-red-600">{error}</p>}
    </div>
  );
}
