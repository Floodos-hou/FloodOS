// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useRef, useState } from 'react';
import type { FieldPlot, HarvesterMachine } from '../../../web/src/types';
import type { BasemapInfo, Pick, Twin, TwinInput } from '../scene/twin';
import { BasemapBadge, FieldPanel, MachinePanel } from './Panels';
import { TwinView } from './TwinView';

interface Props {
  input: TwinInput;
  target: Pick;
  machine?: HarvesterMachine;
  field?: FieldPlot;
  onClose: () => void;
}

/** Full-screen 3D view of one machine or field, opened from the flat map. */
export const Viewer3D: React.FC<Props> = ({ input, target, machine, field, onClose }) => {
  const twin = useRef<Twin | null>(null);
  const [basemap, setBasemap] = useState<BasemapInfo>({ mode: 'loading', attribution: '', loaded: 0, total: 0, zoom: 0 });
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(target.type === 'machine');

  return (
    <div className="viewer" role="dialog" aria-label="Xem 3D">
      <TwinView
        input={input}
        selected={target}
        onPick={() => { /* the view stays on the chosen object */ }}
        onBasemap={setBasemap}
        onReady={(t) => { twin.current = t; t?.focusWhenReady(target); }}
        onError={setError}
      />
      <button className="viewer-close" onClick={onClose}>← Quay lại bản đồ</button>
      {error && <div className="errbar" role="alert">{error}</div>}
      {machine && <MachinePanel m={machine} following={following} onFly={() => twin.current?.flyTo({ type: 'machine', id: machine.machine_id })}
        onFollow={() => { const next = !following; twin.current?.follow(next ? machine.machine_id : null); setFollowing(next); }} onClose={onClose} />}
      {field && <FieldPanel f={field} onFly={() => twin.current?.flyTo({ type: 'field', id: field.field_id })} onClose={onClose} />}
      <footer className="foot"><BasemapBadge info={basemap} /><span>Thiết bị mô phỏng · Hướng máy suy ra từ chuyển động · Mô hình máy là hình minh họa</span></footer>
    </div>
  );
};
