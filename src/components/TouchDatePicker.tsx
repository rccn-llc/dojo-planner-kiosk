'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface TouchDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  placeholder?: string;
  minYear?: number;
  maxYear?: number;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function TouchDatePicker({
  value,
  onChange,
  error,
  placeholder = 'Select date',
  minYear = 1920,
  maxYear,
}: TouchDatePickerProps) {
  const currentYear = new Date().getFullYear();
  const resolvedMaxYear = maxYear ?? currentYear;

  // Parse initial value
  const parsed = useMemo(() => {
    if (!value) {
      return { month: -1, day: -1, year: -1 };
    }
    const parts = value.split('-');
    const y = Number.parseInt(parts[0] ?? '', 10);
    const m = Number.parseInt(parts[1] ?? '', 10) - 1;
    const d = Number.parseInt(parts[2] ?? '', 10);
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
      return { month: -1, day: -1, year: -1 };
    }
    return { month: m, day: d, year: y };
  }, [value]);

  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);
  const [year, setYear] = useState(parsed.year);
  const [isOpen, setIsOpen] = useState(false);

  // Sync internal state when value prop changes
  useEffect(() => {
    setMonth(parsed.month);
    setDay(parsed.day);
    setYear(parsed.year);
  }, [parsed]);

  const maxDay = useMemo(() => {
    if (month < 0 || year < 0) {
      return 31;
    }
    return daysInMonth(month, year);
  }, [month, year]);

  // Clamp day if month/year changed
  useEffect(() => {
    if (day > maxDay) {
      setDay(maxDay);
    }
  }, [day, maxDay]);

  const emit = useCallback((m: number, d: number, y: number) => {
    if (m >= 0 && d > 0 && y > 0) {
      const mm = String(m + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      onChange(`${y}-${mm}-${dd}`);
    }
  }, [onChange]);

  const handleMonthChange = (newMonth: number) => {
    setMonth(newMonth);
    emit(newMonth, day, year);
  };

  const handleDayChange = (newDay: number) => {
    setDay(newDay);
    emit(month, newDay, year);
  };

  const handleYearChange = (newYear: number) => {
    setYear(newYear);
    emit(month, day, newYear);
  };

  const displayText = useMemo(() => {
    if (month < 0 || day < 0 || year < 0) {
      return placeholder;
    }
    const monthName = MONTHS[month] ?? '';
    return `${monthName} ${day}, ${year}`;
  }, [month, day, year, placeholder]);

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = resolvedMaxYear; y >= minYear; y--) {
      arr.push(y);
    }
    return arr;
  }, [minYear, resolvedMaxYear]);

  const days = useMemo(() => {
    const arr: number[] = [];
    for (let d = 1; d <= maxDay; d++) {
      arr.push(d);
    }
    return arr;
  }, [maxDay]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-left text-lg transition-colors ${
          error ? 'border-red-400' : 'border-gray-300'
        } focus:border-black focus:outline-none`}
      >
        <span className={month < 0 ? 'text-gray-400' : 'text-black'}>
          {displayText}
        </span>
      </button>

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      {isOpen && (
        <div className="absolute z-50 mt-2 w-full rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-lg">
          <div className="grid grid-cols-3 gap-3">
            {/* Month */}
            <div>
              <p className="mb-1 text-center text-xs font-semibold text-gray-500">Month</p>
              <select
                value={month}
                onChange={e => handleMonthChange(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-black focus:border-black focus:outline-none"
              >
                <option value={-1}>--</option>
                {MONTHS.map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </select>
            </div>

            {/* Day */}
            <div>
              <p className="mb-1 text-center text-xs font-semibold text-gray-500">Day</p>
              <select
                value={day}
                onChange={e => handleDayChange(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-black focus:border-black focus:outline-none"
              >
                <option value={-1}>--</option>
                {days.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Year */}
            <div>
              <p className="mb-1 text-center text-xs font-semibold text-gray-500">Year</p>
              <select
                value={year}
                onChange={e => handleYearChange(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-black focus:border-black focus:outline-none"
              >
                <option value={-1}>--</option>
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="mt-3 w-full cursor-pointer rounded-xl bg-black py-2 text-center text-sm font-bold text-white transition-all hover:scale-105 active:scale-95"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
