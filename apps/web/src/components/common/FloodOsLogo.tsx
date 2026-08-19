// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';

interface FloodOsLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textVariant?: 'white' | 'dark';
  subtitle?: string;
}

export const FloodOsLogo: React.FC<FloodOsLogoProps> = ({
  size = 44,
  className = '',
  showText = false,
  textVariant = 'white',
  subtitle,
}) => {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {/* Official FloodOS Logo Badge */}
      <div
        className="relative flex shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-md ring-1 ring-black/10 overflow-hidden transition-transform duration-300 hover:scale-105"
        style={{ width: size, height: size }}
        role="img"
        aria-label="FloodOS Logo"
      >
        <img
          src="/logo.png"
          alt="FloodOS"
          className="h-full w-full object-contain"
          loading="eager"
        />
      </div>

      {showText && (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-display text-2xl font-black tracking-tight leading-none ${
                textVariant === 'white' ? 'text-white' : 'text-slate-900'
              }`}
            >
              FloodOS
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          </div>
          {subtitle && (
            <p
              className={`mt-0.5 text-xs truncate ${
                textVariant === 'white' ? 'text-cyan-100/90' : 'text-slate-500'
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
