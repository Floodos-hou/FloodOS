// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useRef } from 'react';
import { Twin, type BasemapInfo, type Pick, type TwinInput } from '../scene/twin';

interface Props {
  input: TwinInput | null;
  selected: Pick | null;
  onPick: (p: Pick | null) => void;
  onBasemap: (i: BasemapInfo) => void;
  onReady: (t: Twin | null) => void;
  onError: (message: string) => void;
}

/** Owns the WebGL canvas: creates the scene once, feeds it data, and disposes it on unmount. */
export const TwinView: React.FC<Props> = ({ input, selected, onPick, onBasemap, onReady, onError }) => {
  const host = useRef<HTMLDivElement>(null);
  const twin = useRef<Twin | null>(null);
  const cb = useRef({ onPick, onBasemap, onReady, onError });
  cb.current = { onPick, onBasemap, onReady, onError };

  useEffect(() => {
    if (!host.current) return;
    let t: Twin;
    try {
      t = new Twin(host.current, { onPick: (p) => cb.current.onPick(p), onBasemap: (i) => cb.current.onBasemap(i) });
    } catch (e) {
      cb.current.onError(`Trình duyệt không bật được WebGL: ${(e as Error).message}`);
      return;
    }
    twin.current = t;
    (window as unknown as { __twin?: () => unknown }).__twin = () => t.debug();
    cb.current.onReady(t);
    return () => { cb.current.onReady(null); t.dispose(); twin.current = null; delete (window as unknown as { __twin?: unknown }).__twin; };
  }, []);

  useEffect(() => { if (input) twin.current?.update(input); }, [input]);
  useEffect(() => { twin.current?.select(selected); }, [selected]);

  return <div className="twin-host" ref={host} data-testid="twin-canvas" />;
};
