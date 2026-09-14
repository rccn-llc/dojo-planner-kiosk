'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface TouchDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  placeholder?: string;
  minYear?: number;
  maxYear?: number;
  /**
   * Latest selectable date as `YYYY-MM-DD`. Pass `todayLocalISO()` for a
   * date-of-birth field.
   *
   * ⚠️ Capping only the YEAR is not enough and was the bug: with `maxYear`
   * alone, the current year stays fully open, so in September someone can pick
   * November of this year and the picker happily emits a date months in the
   * future. This narrows the month and day columns too, once the later columns
   * are on the boundary.
   */
  maxDate?: string;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function ScrollColumn({
  items,
  selectedIndex,
  onSelect,
  label,
}: {
  items: Array<{ value: number; label: string }>;
  selectedIndex: number;
  onSelect: (value: number) => void;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ITEM_HEIGHT = 48;

  // Scroll to selected item on mount and when selection changes
  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      containerRef.current.scrollTop = selectedIndex * ITEM_HEIGHT;
    }
  }, [selectedIndex]);

  return (
    <div className="flex flex-col">
      <p className="mb-1 text-center text-xs font-semibold text-gray-400 uppercase">{label}</p>
      <div
        ref={containerRef}
        className="h-48 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-gray-50"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {items.map((item, i) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onSelect(item.value)}
            className={`flex w-full items-center justify-center transition-colors ${
              i === selectedIndex
                ? 'bg-black font-bold text-white'
                : 'text-black hover:bg-gray-100 active:bg-gray-200'
            }`}
            style={{ height: ITEM_HEIGHT, scrollSnapAlign: 'start' }}
          >
            <span className="text-lg">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TouchDatePicker({
  value,
  onChange,
  label,
  error,
  placeholder = 'Select date',
  minYear = 1920,
  maxYear,
  maxDate,
}: TouchDatePickerProps) {
  const parsedMax = useMemo(() => {
    if (!maxDate) {
      return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(maxDate);
    if (!m) {
      return null;
    }
    return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
  }, [maxDate]);

  const currentYear = new Date().getFullYear();
  const resolvedMaxYear = parsedMax?.year ?? maxYear ?? currentYear;

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

  useEffect(() => {
    setMonth(parsed.month);
    setDay(parsed.day);
    setYear(parsed.year);
  }, [parsed]);

  const maxDay = useMemo(() => {
    if (month < 0 || year < 0) {
      return 31;
    }
    const inMonth = daysInMonth(month, year);
    // Only the boundary month of the boundary year is clipped; every earlier
    // month keeps all of its days.
    if (parsedMax && year === parsedMax.year && month === parsedMax.month) {
      return Math.min(inMonth, parsedMax.day);
    }
    return inMonth;
  }, [month, year, parsedMax]);

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

  /**
   * Clamp a (month, day, year) triple back inside `maxDate`. Without this,
   * switching the YEAR column last leaves an already-chosen "December 31"
   * sitting in a year where that date is still in the future.
   */
  const clamp = useCallback((m: number, d: number, y: number) => {
    if (!parsedMax || y !== parsedMax.year) {
      return { m, d };
    }
    const clampedMonth = m >= 0 ? Math.min(m, parsedMax.month) : m;
    const limit = clampedMonth === parsedMax.month
      ? Math.min(parsedMax.day, daysInMonth(clampedMonth, y))
      : daysInMonth(clampedMonth, y);
    const clampedDay = d > 0 ? Math.min(d, limit) : d;
    return { m: clampedMonth, d: clampedDay };
  }, [parsedMax]);

  const applySelection = useCallback((m: number, d: number, y: number) => {
    const { m: cm, d: cd } = clamp(m, d, y);
    setMonth(cm);
    setDay(cd);
    setYear(y);
    emit(cm, cd, y);
  }, [clamp, emit]);

  const handleMonthChange = (newMonth: number) => applySelection(newMonth, day, year);

  const handleDayChange = (newDay: number) => applySelection(month, newDay, year);

  const handleYearChange = (newYear: number) => applySelection(month, day, newYear);

  const displayText = useMemo(() => {
    if (month < 0 || day < 0 || year < 0) {
      return placeholder;
    }
    return `${MONTHS[month]} ${day}, ${year}`;
  }, [month, day, year, placeholder]);

  const monthItems = useMemo(() => {
    const all = MONTHS.map((name, i) => ({ value: i, label: name }));
    if (parsedMax && year === parsedMax.year) {
      return all.slice(0, parsedMax.month + 1);
    }
    return all;
  }, [parsedMax, year]);
  const dayItems = useMemo(() => {
    const arr = [];
    for (let d = 1; d <= maxDay; d++) {
      arr.push({ value: d, label: String(d) });
    }
    return arr;
  }, [maxDay]);
  const yearItems = useMemo(() => {
    const arr = [];
    for (let y = resolvedMaxYear; y >= minYear; y--) {
      arr.push({ value: y, label: String(y) });
    }
    return arr;
  }, [minYear, resolvedMaxYear]);

  return (
    <div>
      {label && (
        <p className="mb-2 block text-lg font-semibold text-black">{label}</p>
      )}
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`w-full rounded-xl border-2 bg-white px-4 py-4 text-left text-xl transition-colors ${
          error ? 'border-red-400' : 'border-gray-300'
        } focus:border-black focus:outline-none`}
      >
        <span className={month < 0 ? 'text-gray-400' : 'text-black'}>
          {displayText}
        </span>
      </button>

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      {/* Full-screen overlay picker */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setMonth(parsed.month);
                  setDay(parsed.day);
                  setYear(parsed.year);
                  setIsOpen(false);
                }}
                className="cursor-pointer text-lg font-semibold text-gray-400 transition-colors hover:text-black"
              >
                Cancel
              </button>
              <p className="text-lg font-bold text-black">Date of Birth</p>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="cursor-pointer text-lg font-bold text-black transition-colors hover:text-gray-600"
              >
                Done
              </button>
            </div>

            {/* Three scroll columns */}
            <div className="grid grid-cols-3 gap-3">
              <ScrollColumn
                items={monthItems}
                selectedIndex={month}
                onSelect={handleMonthChange}
                label="Month"
              />
              <ScrollColumn
                items={dayItems}
                selectedIndex={day - 1}
                onSelect={handleDayChange}
                label="Day"
              />
              <ScrollColumn
                items={yearItems}
                selectedIndex={year > 0 ? resolvedMaxYear - year : -1}
                onSelect={handleYearChange}
                label="Year"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
