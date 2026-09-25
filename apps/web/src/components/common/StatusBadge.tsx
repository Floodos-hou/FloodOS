// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import {
  TONE_CLASS,
  type Tone,
  type Label,
  reportStatus,
  orderStatus,
  vehicleStatus,
  zoneRisk,
  shelterStatus,
  gaugeAlert,
} from '../../utils/labels';

interface StatusBadgeProps {
  label?: { text: string; tone: Tone; icon: string };
  status?: string;
  type?: 'report' | 'order' | 'vehicle' | 'zone' | 'gauge' | 'shelter' | string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, status, type, className = '' }) => {
  let resolved: Label | undefined = label;
  if (!resolved && status) {
    if (type === 'report') resolved = reportStatus(status);
    else if (type === 'order') resolved = orderStatus(status);
    else if (type === 'vehicle') resolved = vehicleStatus(status);
    else if (type === 'zone') resolved = zoneRisk(status);
    else if (type === 'shelter') resolved = shelterStatus(status);
    else if (type === 'gauge') resolved = gaugeAlert(status);
    else resolved = { text: status, tone: 'neutral', icon: '' };
  }
  if (!resolved) return null;
  const toneClass = TONE_CLASS[resolved.tone] || TONE_CLASS.neutral;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap shrink-0 ${toneClass} ${className}`}>
      {resolved.icon && <span aria-hidden="true">{resolved.icon}</span>}
      {resolved.text}
    </span>
  );
};
