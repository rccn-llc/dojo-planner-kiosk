'use client';

import type { ReactNode } from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

interface KioskFlowHeaderProps {
  title: string;
  onBack: () => void;
  /** Optional content for the right side. Defaults to a spacer to keep the title centered. */
  rightSlot?: ReactNode;
}

export function KioskFlowHeader({ title, onBack, rightSlot }: KioskFlowHeaderProps) {
  return (
    <header className="flex items-center justify-between bg-black p-4 sm:p-6 md:p-8">
      <button
        type="button"
        onClick={onBack}
        className="cursor-pointer text-white transition-colors hover:text-gray-300"
      >
        <ArrowBackIcon sx={{ fontSize: 48 }} />
      </button>
      <h1 className="flex-1 text-center text-2xl font-bold text-white sm:text-3xl md:text-5xl">
        {title}
      </h1>
      {rightSlot ?? <div className="w-12" />}
    </header>
  );
}
