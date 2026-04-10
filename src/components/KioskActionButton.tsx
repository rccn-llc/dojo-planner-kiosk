'use client';

interface KioskActionButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'dark';
}

export function KioskActionButton({ label, onClick, variant = 'default' }: KioskActionButtonProps) {
  const baseClass = 'flex min-h-32 cursor-pointer items-center justify-center rounded-3xl border-2 border-black text-center transition-all duration-300 hover:scale-105 sm:min-h-40 md:min-h-48';
  const variantClass = variant === 'dark'
    ? 'bg-black'
    : 'bg-white hover:bg-gray-100';
  const textClass = variant === 'dark'
    ? 'text-3xl font-bold text-white'
    : 'text-3xl font-bold text-black';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClass} ${variantClass}`}
    >
      <h2 className={textClass}>{label}</h2>
    </button>
  );
}
