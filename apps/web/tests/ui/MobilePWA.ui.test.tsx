// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileFloatingBar } from '../../src/components/mobile/MobileFloatingBar';
import { MobileSOSModal } from '../../src/components/mobile/MobileSOSModal';
import { setVoiceAlertsEnabled, getVoiceAlertsEnabled } from '../../src/utils/voiceAlert';

describe('Mobile PWA & Quick SOS components', () => {
  beforeEach(() => {
    setVoiceAlertsEnabled(true);
  });

  it('renders MobileFloatingBar with SOS button and controls', () => {
    const onSelectTab = vi.fn();
    const onOpenSOS = vi.fn();

    render(
      <MobileFloatingBar
        currentTab="HOME"
        onSelectTab={onSelectTab}
        onOpenSOS={onOpenSOS}
      />
    );

    const sosBtn = screen.getByRole('button', { name: /sos cứu hộ/i });
    expect(sosBtn).toBeDefined();
    fireEvent.click(sosBtn);
    expect(onOpenSOS).toHaveBeenCalledTimes(1);

    const voiceBtn = screen.getByRole('button', { name: /tắt cảnh báo giọng nói/i });
    expect(voiceBtn).toBeDefined();
    fireEvent.click(voiceBtn);
    expect(getVoiceAlertsEnabled()).toBe(false);

    const viewBtn = screen.getByRole('button', { name: /mở bản đồ/i });
    expect(viewBtn).toBeDefined();
    fireEvent.click(viewBtn);
    expect(onSelectTab).toHaveBeenCalledWith('MAP');
  });

  it('submits emergency report through MobileSOSModal with GPS coordinates', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    // Mock geolocation
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success) =>
        success({
          coords: {
            latitude: 21.02851,
            longitude: 105.85422,
            accuracy: 9,
          },
        })
      ),
    };
    vi.stubGlobal('navigator', {
      ...window.navigator,
      geolocation: mockGeolocation,
    });

    render(
      <MobileSOSModal
        isOpen={true}
        onClose={onClose}
        zones={[{
          zone_id: 'Z-01',
          name: 'Ba Đình',
          organization_id: 'ORG-1',
          risk_level: 'WARNING',
          polygon: [[[21.0, 105.8], [21.1, 105.8], [21.1, 105.9], [21.0, 105.8]]],
          center_lat: 21.03,
          center_lng: 105.83,
          data_origin: 'SEED',
        }]}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole('heading', { name: /báo ngập khẩn cấp/i })).toBeDefined();

    // Select need: Cấp cứu y tế
    const medBtn = screen.getByRole('button', { name: /cấp cứu y tế/i });
    fireEvent.click(medBtn);

    // Select depth: 100 cm
    const depthBtn = screen.getByRole('button', { name: /100 cm/i });
    fireEvent.click(depthBtn);

    // Select 4 people
    const peopleBtn = screen.getByRole('button', { name: /4 người/i });
    fireEvent.click(peopleBtn);

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /phát tín hiệu cứu hộ ngay/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const callPayload = onSubmit.mock.calls[0][0];
    expect(callPayload.need_type).toBe('MEDICAL');
    expect(callPayload.depth_cm).toBe(100);
    expect(callPayload.people_affected).toBe(4);
    expect(callPayload.lat).toBeCloseTo(21.02851, 4);
    expect(callPayload.lng).toBeCloseTo(105.85422, 4);
  });
});
