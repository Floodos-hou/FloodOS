// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { TONE_CLASS } from '../../utils/labels';

interface StatusBadgeProps {
  label: { text: string; tone: keyof typeof TONE_CLASS; icon: string };
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${TONE_CLASS[label.tone]}`}>
    {label.icon && <span aria-hidden="true">{label.icon}</span>}
    {label.text}
  </span>
);
