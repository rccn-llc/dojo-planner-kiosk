'use client';

interface KioskActionButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'dark' | 'green' | 'blue';
}

export function KioskActionButton({ label, onClick, variant = 'default' }: KioskActionButtonProps) {
  const baseClass = 'flex min-h-32 cursor-pointer items-center justify-center rounded-3xl border-2 text-center transition-all duration-300 hover:scale-105 sm:min-h-40 md:min-h-48';

  const variantClass = (() => {
    switch (variant) {
      case 'dark':
        return 'border-black bg-black';
      case 'green':
        return 'border-[var(--color-green-200)] bg-[var(--color-green-200)] hover:bg-[var(--color-green-300)]';
      case 'blue':
        return 'border-[var(--color-blue-500)] bg-[var(--color-blue-500)] hover:bg-[var(--color-blue-600)]';
      default:
        return 'border-black bg-white hover:bg-gray-100';
    }
  })();

  const textClass = (variant === 'default' || variant === 'green')
    ? 'text-3xl font-bold text-black'
    : 'text-3xl font-bold text-white';

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
