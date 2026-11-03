// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import {
  TONE_CLASS,
  type Label,
  reportStatus,
  orderStatus,
  vehicleStatus,
  zoneRisk,
  shelterStatus,
  gaugeAlert,
  priority,
} from '../../utils/labels';

interface StatusBadgeProps {
  label?: Label;
  status?: string;
  type?: 'report' | 'order' | 'vehicle' | 'zone' | 'gauge' | 'shelter' | 'priority' | string;
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
    else if (type === 'priority') resolved = priority(status);
    else resolved = { text: status, tone: 'neutral', icon: '' };
  }
  if (!resolved) return null;
  return <span className={`chip ${TONE_CLASS[resolved.tone] || TONE_CLASS.neutral} ${className}`}>{resolved.text}</span>;
};
