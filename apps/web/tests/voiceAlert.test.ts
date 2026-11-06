// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isVoiceAlertSupported,
  getVoiceAlertsEnabled,
  setVoiceAlertsEnabled,
  speakVoiceAlert,
  formatReportVoiceAlert,
  formatOrderVoiceAlert,
  formatIncidentVoiceAlert,
  formatGaugeVoiceAlert,
} from '../src/utils/voiceAlert.ts';

test('voice alerts: formatters output clear Vietnamese tactical phrases', () => {
  const reportMsg = formatReportVoiceAlert({
    need_type: 'EVACUATION',
    depth_cm: 65,
    people_affected: 4,
    address_hint: 'ngõ 165 Cầu Giấy',
  });
  assert.match(reportMsg, /Cảnh báo khẩn cấp/);
  assert.match(reportMsg, /Sơ tán, cứu nạn/);
  assert.match(reportMsg, /ngõ 165 Cầu Giấy/);
  assert.match(reportMsg, /ngập sâu 65 xăng-ti-mét/);
  assert.match(reportMsg, /có 4 người cần hỗ trợ/);

  const orderMsg = formatOrderVoiceAlert({
    team_name: 'Đội Cứu nạn 01',
    zone_name: 'Vùng Trũng Cầu Giấy',
  });
  assert.match(orderMsg, /Lệnh điều động mới: Đội Cứu nạn 01/);
  assert.match(orderMsg, /khu vực Vùng Trũng Cầu Giấy/);

  const incidentMsg = formatIncidentVoiceAlert({
    vehicle_id: 'BOAT-02',
    incident_type: 'PROPELLER_FOULED',
  });
  assert.match(incidentMsg, /BOAT-02 gặp sự cố/);
  assert.match(incidentMsg, /phương án thay thế/);

  const gaugeMsg = formatGaugeVoiceAlert({
    station_name: 'Trạm Thủy văn Cầu Diễn',
    water_level_cm: 280,
  });
  assert.match(gaugeMsg, /Cảnh báo lũ lụt: Trạm Thủy văn Cầu Diễn đã vượt ngưỡng báo động/);
  assert.match(gaugeMsg, /mực nước hiện tại 280 xăng-ti-mét/);
});

test('voice alerts: safe execution in headless / Node.js test environment', () => {
  // In pure Node.js, window is undefined
  assert.equal(isVoiceAlertSupported(), false);
  // speakVoiceAlert must fail-safe and return false rather than crashing
  const result = speakVoiceAlert('Thử nghiệm hệ thống cảnh báo');
  assert.equal(result, false);
});

test('voice alerts: mock browser speech synthesis workflow', () => {
  let spokenText = '';
  let canceled = false;
  let speakCalls = 0;

  class MockSpeechSynthesisUtterance {
    text: string;
    lang = '';
    rate = 1.0;
    pitch = 1.0;
    voice: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  const mockStorage: Record<string, string> = {};

  const mockWindow = {
    SpeechSynthesisUtterance: MockSpeechSynthesisUtterance,
    speechSynthesis: {
      cancel: () => {
        canceled = true;
      },
      speak: (u: MockSpeechSynthesisUtterance) => {
        speakCalls++;
        spokenText = u.text;
      },
      getVoices: () => [
        { name: 'Google Vietnamese', lang: 'vi-VN' },
        { name: 'Microsoft David', lang: 'en-US' },
      ],
    },
    localStorage: {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    },
    dispatchEvent: () => true,
  };

  // Bind mock window to global scope temporarily
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = mockWindow;

  try {
    assert.equal(isVoiceAlertSupported(), true);
    assert.equal(getVoiceAlertsEnabled(), true);

    // Speak urgent alert
    const ok = speakVoiceAlert('Báo động khẩn cấp!', { urgent: true, chime: false });
    assert.equal(ok, true);
    assert.equal(canceled, true);
    assert.equal(spokenText, 'Báo động khẩn cấp!');
    assert.equal(speakCalls, 1);

    // Disable alerts
    setVoiceAlertsEnabled(false);
    assert.equal(getVoiceAlertsEnabled(), false);

    // When disabled, speakVoiceAlert should not speak
    const blocked = speakVoiceAlert('Thông báo thử nghiệm', { chime: false });
    assert.equal(blocked, false);
    assert.equal(speakCalls, 1); // no new speak calls

    // Re-enable
    setVoiceAlertsEnabled(true);
    assert.equal(getVoiceAlertsEnabled(), true);
    const reOk = speakVoiceAlert('Đã bật lại thông báo', { chime: false });
    assert.equal(reOk, true);
    assert.equal(speakCalls, 2);
    assert.equal(spokenText, 'Đã bật lại thông báo');
  } finally {
    // Restore
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  }
});
