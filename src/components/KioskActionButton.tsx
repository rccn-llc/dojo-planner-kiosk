'use client';

interface KioskActionButtonProps {
  label: string;
  onClick: () => void;
}

export function KioskActionButton({ label, onClick }: KioskActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center justify-center rounded-3xl border-2 border-black bg-white py-8 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100 sm:py-10 md:py-12"
    >
      <h2 className="text-3xl font-bold text-black">{label}</h2>
    </button>
  );
}
