'use client';

interface StepIndicatorProps {
  /** 0-based index of the current step. */
  current: number;
  /** Total number of steps. */
  total: number;
}

export function StepIndicator({ current, total }: StepIndicatorProps) {
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 w-8 rounded-full transition-colors ${i <= current ? 'bg-black' : 'bg-gray-300'}`}
        />
      ))}
    </div>
  );
}
