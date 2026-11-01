// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React from 'react';

interface OpenAgriLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textVariant?: 'white' | 'dark';
  subtitle?: string;
}

export const OpenAgriLogo: React.FC<OpenAgriLogoProps> = ({
  size = 44,
  className = '',
  showText = false,
  textVariant = 'white',
  subtitle,
}) => {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {/* Official OpenAgriOS Vector Logo from Repo */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="OpenAgriOS Logo"
        className="shrink-0 transition-transform duration-300 hover:scale-105 drop-shadow-md"
      >
        {/* Background Tile */}
        <rect width="64" height="64" rx="14" fill="#2F5C22" />
        <rect
          x="1"
          y="1"
          width="62"
          height="62"
          rx="13"
          stroke="#558B3E"
          strokeWidth="1.5"
          strokeOpacity="0.4"
        />

        {/* Golden Central Sprout Stem */}
        <path
          d="M32 54V30"
          stroke="#F2CB52"
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* Left Leaf (Soft Green) */}
        <path
          d="M32 32C23 32 18 26 18 18C27 18 32 24 32 32Z"
          fill="#95C47B"
        />

        {/* Right Leaf (Vivid Green) */}
        <path
          d="M32 26C41 26 46 20 46 14C37 14 32 20 32 26Z"
          fill="#6BA84E"
        />

        {/* Horizontal Soil / Earth Foundation Bar */}
        <path
          d="M16 54H48"
          stroke="#BDDCAB"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>

      {showText && (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-display text-2xl font-bold tracking-tight leading-none ${
                textVariant === 'white' ? 'text-white' : 'text-slate-900'
              }`}
            >
              OpenAgriOS
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          </div>
          {subtitle && (
            <p
              className={`mt-0.5 text-xs truncate ${
                textVariant === 'white' ? 'text-emerald-100/90' : 'text-slate-500'
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
