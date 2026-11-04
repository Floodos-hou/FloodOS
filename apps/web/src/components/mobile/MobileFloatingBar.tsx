// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useState } from 'react';
import { Map as MapIcon, Radio, Volume2, VolumeX, LayoutDashboard } from 'lucide-react';
import { getVoiceAlertsEnabled, setVoiceAlertsEnabled, speakVoiceAlert } from '../../utils/voiceAlert';

interface MobileFloatingBarProps {
  currentTab: string;
  onSelectTab: (tab: 'HOME' | 'MAP') => void;
  onOpenSOS: () => void;
}

export const MobileFloatingBar: React.FC<MobileFloatingBarProps> = ({
  currentTab,
  onSelectTab,
  onOpenSOS,
}) => {
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => getVoiceAlertsEnabled());

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ enabled: boolean }>;
      if (custom.detail) {
        setVoiceEnabled(custom.detail.enabled);
      }
    };
    window.addEventListener('floodos-voice-toggle', handler);
    return () => window.removeEventListener('floodos-voice-toggle', handler);
  }, []);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceAlertsEnabled(next);
    setVoiceEnabled(next);
    if (next) {
      speakVoiceAlert('Đã bật cảnh báo giọng nói.');
    }
  };

  return (
    <aside aria-label="Thanh tác vụ nhanh di động" className="fixed bottom-16 right-3 left-3 z-35 flex items-center justify-between gap-2 pointer-events-none md:hidden">
      {/* 1-Tap SOS Emergency Trigger */}
      <button
        type="button"
        onClick={onOpenSOS}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-crit bg-crit px-4 py-2.5 text-xs font-bold text-white shadow-lg active:scale-95 transition-transform"
      >
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
        </span>
        <Radio className="h-4 w-4 text-white" aria-hidden="true" />
        <span className="tracking-wide">SOS CỨU HỘ</span>
      </button>

      {/* Floating Controls: Voice & Quick View Toggle */}
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-sheet/95 backdrop-blur-md p-1 shadow-md">
        {/* Voice Alert Toggle */}
        <button
          type="button"
          onClick={toggleVoice}
          title={voiceEnabled ? 'Tắt cảnh báo giọng nói' : 'Bật cảnh báo giọng nói'}
          aria-label={voiceEnabled ? 'Tắt cảnh báo giọng nói' : 'Bật cảnh báo giọng nói'}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            voiceEnabled ? 'bg-river-soft text-river-2 font-bold' : 'text-ink-3 hover:bg-sheet-2'
          }`}
        >
          {voiceEnabled ? (
            <Volume2 className="h-4 w-4 text-river" aria-hidden="true" />
          ) : (
            <VolumeX className="h-4 w-4 text-ink-3" aria-hidden="true" />
          )}
        </button>

        {/* Quick Map/Workspace Toggle */}
        <button
          type="button"
          onClick={() => onSelectTab(currentTab === 'MAP' ? 'HOME' : 'MAP')}
          title={currentTab === 'MAP' ? 'Về trang chính' : 'Mở bản đồ'}
          aria-label={currentTab === 'MAP' ? 'Về trang chính' : 'Mở bản đồ'}
          className="flex h-9 items-center gap-1.5 rounded-full bg-sheet-2 px-3 text-xs font-semibold text-ink hover:bg-line/40 transition-colors"
        >
          {currentTab === 'MAP' ? (
            <>
              <LayoutDashboard className="h-3.5 w-3.5 text-river" aria-hidden="true" />
              <span>Nhiệm vụ</span>
            </>
          ) : (
            <>
              <MapIcon className="h-3.5 w-3.5 text-river" aria-hidden="true" />
              <span>Bản đồ</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
