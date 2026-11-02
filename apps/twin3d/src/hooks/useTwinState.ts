// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../web/src/services/api';
import type { TacticalState } from '../../../web/src/types';

const POLL_MS = 3_000;

/** Polls the tactical state (the same RLS-filtered API as the operations portal). Pauses while the tab is hidden. */
export function useTwinState(token: string | null, onUnauthorized: () => void) {
  const [state, setState] = useState<TacticalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const refresh = useCallback(async () => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    try {
      setState(await api.getTacticalState(token));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) unauthorized.current();
      else setError((e as Error).message || 'Không tải được dữ liệu');
    } finally {
      inFlight.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refresh();
    const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [token, refresh]);

  return { state, error, refresh };
}
