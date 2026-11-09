// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';

interface FloodOsLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  subtitle?: string;
  /** on dark backgrounds (login brand panel) */
  inverse?: boolean;
}

/** Mark = a water-level staff (thước đo mực nước): ticks on the left, waterline across the middle. */
export const FloodOsMark: React.FC<{ size?: number; inverse?: boolean }> = ({ size = 32, inverse = false }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="FloodOS" fill="none" className="drop-shadow-xs">
    <rect width="32" height="32" rx="8" fill={inverse ? '#ffffff' : '#0284c7'} />
    <g stroke={inverse ? '#0369a1' : '#ffffff'} strokeWidth="2" strokeLinecap="round">
      <path d="M8 7v18" />
      <path d="M8 9.5h4.5M8 14h2.5M8 18.5h4.5M8 23h2.5" />
    </g>
    <path d="M14.5 16.5c1.6-1.8 3.2-1.8 4.8 0s3.2 1.8 4.8 0 2.8-1.5 3.9 0" stroke={inverse ? '#0ea5e9' : '#bae6fd'} strokeWidth="2.2" strokeLinecap="round" />
    <path d="M14.5 21.5c1.6-1.8 3.2-1.8 4.8 0s3.2 1.8 4.8 0 2.8-1.5 3.9 0" stroke={inverse ? '#0369a1' : '#ffffff'} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const FloodOsLogo: React.FC<FloodOsLogoProps> = ({ size = 32, className = '', showText = false, subtitle, inverse = false }) => (
  <div className={`inline-flex items-center gap-2.5 ${className}`}>
    <span className="shrink-0"><FloodOsMark size={size} inverse={inverse} /></span>
    {showText && (
      <div className="min-w-0 leading-tight">
        <div className={`font-display text-[17px] font-bold tracking-tight ${inverse ? 'text-white' : 'text-ink'}`}>
          Flood<span className={inverse ? 'text-sky-300' : 'text-river'}>OS</span>
        </div>
        {subtitle && <div className={`truncate text-[11px] font-medium ${inverse ? 'text-sky-100/80' : 'text-ink-3'}`}>{subtitle}</div>}
      </div>
    )}
  </div>
);
