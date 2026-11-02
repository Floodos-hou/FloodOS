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
      {/* Official FloodOS Vector Logo: Emergency Flood Defense Shield with Water Wave and Beacon */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="FloodOS Logo"
        className="shrink-0 transition-transform duration-300 hover:scale-105 drop-shadow-md"
      >
        <defs>
          <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0369a1" />
            <stop offset="50%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#bae6fd" />
          </linearGradient>
        </defs>

        {/* Shield Outer Foundation */}
        <path
          d="M32 4L10 14V30C10 44 19.5 54.5 32 60C44.5 54.5 54 44 54 30V14L32 4Z"
          fill="url(#shieldGrad)"
          stroke="#38bdf8"
          strokeWidth="2"
        />

        {/* Wave 1: Dynamic Water Crest */}
        <path
          d="M16 34C20 30 25 38 30 34C35 30 40 38 48 32V42C44 47 38 52 32 54C26 52 20 47 16 42V34Z"
          fill="url(#waveGrad)"
          opacity="0.85"
        />

        {/* Wave 2: Surface Ripple */}
        <path
          d="M18 28C22 25 26 31 31 28C36 25 41 31 46 27"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Emergency Beacon at Center Top */}
        <circle cx="32" cy="18" r="4.5" fill="#f59e0b" />
        <circle cx="32" cy="18" r="7.5" stroke="#fef08a" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.8" />
      </svg>

      {showText && (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-display text-2xl font-bold tracking-tight leading-none ${
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
