// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { REQUEST_STEPS } from '../../utils/progress';

interface ProgressStepsProps {
  steps?: string[];
  /** Number of finished steps (the next one is "current") */
  done: number;
  /** Current step hit a problem (e.g. machine breakdown) */
  problem?: boolean;
}

export const ProgressSteps: React.FC<ProgressStepsProps> = ({ steps = REQUEST_STEPS, done, problem = false }) => (
  <ol className="flex items-start" aria-label="Các bước của yêu cầu">
    {steps.map((label, i) => {
      const finished = i < done;
      const current = i === done && done < steps.length;
      const bad = current && problem;
      return (
        <li key={label} className="relative flex flex-1 flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
          {i > 0 && (
            <span aria-hidden="true" className={`absolute right-1/2 top-5 h-1.5 w-full -translate-y-1/2 ${i <= done ? 'bg-emerald-600' : 'bg-slate-200'}`} />
          )}
          <span
            className={`relative z-10 grid h-10 w-10 place-items-center rounded-full border-4 text-base font-bold ${
              finished ? 'border-emerald-600 bg-emerald-600 text-white'
              : bad ? 'border-red-500 bg-red-50 text-red-700'
              : current ? 'border-amber-400 bg-amber-100 text-amber-900 ring-4 ring-amber-100'
              : 'border-slate-300 bg-white text-slate-400'
            }`}
          >
            {finished ? <Check aria-hidden="true" className="h-5 w-5" /> : bad ? <AlertTriangle aria-hidden="true" className="h-5 w-5" /> : i + 1}
          </span>
          <span className={`mt-2 px-0.5 text-sm font-semibold leading-tight ${finished ? 'text-emerald-800' : bad ? 'text-red-700' : current ? 'text-slate-900' : 'text-slate-500'}`}>
            {label}
          </span>
        </li>
      );
    })}
  </ol>
);
