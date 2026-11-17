import React from 'react';

interface LogoProps {
  compact?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ compact = false, className = '' }) => {
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Subtle 8-point Islamic Geometric Star (Rub el Hizb) Emblem */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="7.5"
          y="7.5"
          width="21"
          height="21"
          rx="1"
          stroke="#C9A45C"
          strokeWidth="1.25"
        />
        <rect
          x="7.5"
          y="7.5"
          width="21"
          height="21"
          rx="1"
          transform="rotate(45 18 18)"
          stroke="#E5C88B"
          strokeWidth="1.25"
        />
        <circle cx="18" cy="18" r="5.5" stroke="#C9A45C" strokeWidth="1.1" fill="#10214A" />
        <circle cx="18" cy="18" r="2" fill="#E5C88B" />
      </svg>

      {!compact && (
        <div className="flex flex-col leading-none">
          <span className="font-display text-[22px] font-semibold tracking-[0.14em] text-[#F8FAFC] whitespace-nowrap">
            NUR-I DUA
          </span>
        </div>
      )}
    </div>
  );
};
