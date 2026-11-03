// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind max-width class, e.g. "max-w-lg" */
  size?: string;
  isOpen?: boolean;
}

/** Accessible dialog: Esc closes, backdrop click closes, labelled for screen readers. Bottom sheet on phones. */
export const Modal: React.FC<ModalProps> = ({ title, onClose, children, size = 'max-w-lg', isOpen = true }) => {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full ${size} flex-col rounded-t-lg border border-line bg-sheet text-ink shadow-[var(--shadow-pop)] sm:rounded-lg`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h3 id={titleId} className="text-base font-bold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="btn btn-ghost !min-h-9 !px-2">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
};
