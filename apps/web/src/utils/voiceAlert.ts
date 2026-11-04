// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import type { FloodReport, DispatchOrder, FieldIncident, GaugeStation } from '../types';

const STORAGE_KEY = 'floodos_voice_alerts_enabled';
const VOICE_TOGGLE_EVENT = 'floodos-voice-toggle';

const NEED_SPOKEN: Record<string, string> = {
  EVACUATION: 'Sơ tán, cứu nạn',
  MEDICAL: 'Cấp cứu y tế',
  FOOD_WATER: 'Tiếp tế lương thực và nước uống',
  PUMPING: 'Bơm thoát nước',
  ROAD_BLOCKED: 'Đường bị ngập cô lập',
};

/** Checks if Web Speech API is available in the current browser runtime */
export const isVoiceAlertSupported = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
};

/** Checks whether user has enabled voice alerts (defaults to true) */
export const getVoiceAlertsEnabled = (): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  try {
    const val = window.localStorage.getItem(STORAGE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
};

/** Enables or disables voice alerts and notifies listening components */
export const setVoiceAlertsEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(VOICE_TOGGLE_EVENT, { detail: { enabled } }));
  } catch {
    // ignore storage quota / access errors
  }
};

/** Tactical Audio Beep / Chime using Web Audio API */
export const playTacticalChime = (urgent = false): void => {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = urgent ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(urgent ? 880 : 660, now);
    if (urgent) {
      osc.frequency.setValueAtTime(1320, now + 0.08);
    }

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (urgent ? 0.22 : 0.18));

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + (urgent ? 0.22 : 0.18));
  } catch {
    // harmless if audio context is blocked
  }
};

export interface SpeakOptions {
  urgent?: boolean;
  interrupt?: boolean;
  lang?: string;
  chime?: boolean;
}

/**
 * Broadcasts an audio voice alert via browser Web Speech API.
 * Safe to call anywhere; silently no-ops in SSR or test runners without browser APIs.
 */
export const speakVoiceAlert = (text: string, options: SpeakOptions = {}): boolean => {
  if (!text || !text.trim()) return false;
  if (!isVoiceAlertSupported() || !getVoiceAlertsEnabled()) return false;

  try {
    const { urgent = false, interrupt = false, lang = 'vi-VN', chime = true } = options;

    if (interrupt || urgent) {
      window.speechSynthesis.cancel();
    }

    if (chime) {
      playTacticalChime(urgent);
    }

    const utterance = new window.SpeechSynthesisUtterance(text.trim());
    utterance.lang = lang;
    utterance.rate = urgent ? 1.08 : 1.0;
    utterance.pitch = urgent ? 1.05 : 1.0;

    // Pick a Vietnamese voice if available in the system
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const viVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('vi'));
    if (viVoice) {
      utterance.voice = viVoice;
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
};

// ----------------------------------------------------------------------------
// Voice Alert Formatters (Vietnamese Natural Spoken Language)
// ----------------------------------------------------------------------------

export const formatReportVoiceAlert = (report: Partial<FloodReport>): string => {
  const need = (report.need_type && NEED_SPOKEN[report.need_type]) || 'cứu hộ ngập lụt';
  const depth = report.depth_cm ?? report.flood_depth_cm;
  const depthStr = depth ? `, ngập sâu ${depth} xăng-ti-mét` : '';
  const people = report.people_affected ?? report.people_count;
  const peopleStr = people ? `, có ${people} người cần hỗ trợ` : '';
  const loc = report.address_hint || 'tại vị trí tin báo';

  return `Cảnh báo khẩn cấp: Yêu cầu ${need} ${loc}${depthStr}${peopleStr}.`;
};

export const formatOrderVoiceAlert = (order: Partial<DispatchOrder>): string => {
  const team = order.team_name || 'Đội ứng cứu';
  const loc = order.zone_name ? `khu vực ${order.zone_name}` : 'vị trí chỉ định';
  return `Lệnh điều động mới: ${team}, khẩn trương cơ động đến ${loc}.`;
};

export const formatIncidentVoiceAlert = (incident: Partial<FieldIncident>): string => {
  const vehicle = incident.vehicle_id || 'Phương tiện';
  return `Cảnh báo kỹ thuật: ${vehicle} gặp sự cố, hệ thống đang kích hoạt phương án thay thế.`;
};

export const formatGaugeVoiceAlert = (gauge: Partial<GaugeStation>): string => {
  const name = gauge.station_name || gauge.name || 'Trạm đo';
  const level = gauge.water_level_cm ?? gauge.level_cm;
  const levelStr = level ? `, mực nước hiện tại ${level} xăng-ti-mét` : '';
  return `Cảnh báo lũ lụt: ${name} đã vượt ngưỡng báo động${levelStr}.`;
};
