// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useState } from 'react';
import { useAuth } from '../../context/useAuth';
import { DEMO_CHARACTERS, DEMO_STEPS } from '../../demo/demoScript';

/** Floating storyline helper (demo builds only): shows whose turn it is and how to switch character. */
export const DemoGuide: React.FC = () => {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const me = DEMO_CHARACTERS.find((c) => c.username === user?.username);

  return (
    <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <aside aria-label="Kịch bản demo" className="max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border-2 border-amber-400 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">🎬 Kịch bản demo</h2>
              <p className="text-base text-slate-600">Bạn đang đóng vai: <strong>{me ? `${me.emoji} ${me.name}` : user?.full_name}</strong></p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Thu gọn" className="rounded-xl px-3 py-1 text-lg font-bold text-slate-500 hover:bg-slate-100">✕</button>
          </div>

          <ol className="mt-4 space-y-3">
            {DEMO_STEPS.map((s, i) => {
              const who = DEMO_CHARACTERS.find((c) => c.username === s.who);
              const mine = s.who === user?.username;
              return (
                <li key={i} className={`rounded-2xl border-2 p-3 ${mine ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                  <p className="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-700 text-sm text-white">{i + 1}</span>
                    {who?.emoji} {s.title}
                    {mine && <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-sm text-white">👉 Đến lượt bạn</span>}
                  </p>
                  {mine ? (
                    <>
                      <p className="mt-2 text-base text-slate-800"><strong>Làm:</strong> {s.doThis}</p>
                      <p className="mt-1 text-base text-emerald-900"><strong>Sẽ thấy:</strong> {s.youSee}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-slate-600">Đăng nhập là <strong>{who?.name}</strong> để làm bước này.</p>
                  )}
                </li>
              );
            })}
          </ol>

          <button type="button" onClick={() => logout()} className="mt-5 min-h-12 w-full rounded-2xl bg-amber-300 px-4 py-2.5 text-lg font-bold text-emerald-950 shadow hover:bg-amber-200">
            🔄 Đổi nhân vật
          </button>
        </aside>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="min-h-14 rounded-full bg-amber-300 px-6 py-3 text-lg font-bold text-emerald-950 shadow-xl ring-4 ring-white hover:bg-amber-200"
      >
        🎬 {open ? 'Ẩn kịch bản' : 'Kịch bản demo'}
      </button>
    </div>
  );
};
