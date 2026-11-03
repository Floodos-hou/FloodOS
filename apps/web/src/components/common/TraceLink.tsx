// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { ExternalLink } from 'lucide-react';

const ORIGIN = import.meta.env.VITE_API_GATEWAY_URL ?? '';

/** Tier-3 traceability entry point: a scannable QR and the public page that independently re-verifies the hash chain. */
export const TraceLink: React.FC<{ traceId: string }> = ({ traceId }) => {
  const safe = encodeURIComponent(traceId);
  return (
    <a
      href={`${ORIGIN}/trace/${safe}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-3 rounded border border-line-2 bg-sheet p-2 pr-3 hover:border-river"
      title="Mở trang truy xuất nguồn gốc công khai (quét mã QR để chia sẻ)"
    >
      <img src={`${ORIGIN}/trace/${safe}/qr.svg`} alt={`Mã QR truy xuất ${traceId}`} width={64} height={64} className="rounded-md" />
      <span className="text-left text-sm leading-snug">
        <strong className="block text-ink">Truy xuất nguồn gốc</strong>
        <span className="text-ink-2">Trang công khai, tự kiểm lại mã băm</span>
        <ExternalLink className="ml-1 inline h-3.5 w-3.5 text-river" aria-hidden />
      </span>
    </a>
  );
};
