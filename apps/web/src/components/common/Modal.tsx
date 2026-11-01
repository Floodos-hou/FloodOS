// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind max-width class, e.g. "max-w-lg" */
  size?: string;
}

/** Accessible dialog: Esc closes, backdrop click closes, labelled for screen readers. */
export const Modal: React.FC<ModalProps> = ({ title, onClose, children, size = 'max-w-lg' }) => {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`w-full ${size} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl`}>
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <h3 id={titleId} className="font-display text-xl font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="grid h-11 w-11 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
            <X aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};
