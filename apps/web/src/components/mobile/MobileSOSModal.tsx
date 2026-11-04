// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Camera, Check, Loader2, LocateFixed, MapPin, Radio, X } from 'lucide-react';
import type { FloodZone } from '../../types';
import { speakVoiceAlert } from '../../utils/voiceAlert';
import { validateReportDescription } from '../../utils/workflowRules';

interface MobileSOSModalProps {
  isOpen: boolean;
  onClose: () => void;
  zones?: FloodZone[];
  onSubmit: (data: {
    lat: number;
    lng: number;
    depth_cm: number;
    need_type: string;
    people_affected: number;
    description: string;
    evidence_filename?: string;
    evidence_data_url?: string;
  }) => Promise<void>;
}

const NEEDS = [
  { id: 'EVACUATION', label: 'Sơ tán khẩn cấp', icon: '🚨' },
  { id: 'MEDICAL', label: 'Cấp cứu y tế', icon: '🚑' },
  { id: 'FOOD_WATER', label: 'Tiếp tế lương thực', icon: '🍞' },
  { id: 'ROAD_BLOCKED', label: 'Đường bị cô lập', icon: '⛔' },
  { id: 'PUMPING', label: 'Bơm thoát nước', icon: '💧' },
] as const;

const DEPTH_PRESETS = [
  { cm: 30, label: '30 cm (Đầu gối)' },
  { cm: 60, label: '60 cm (Ngang hông)' },
  { cm: 100, label: '100 cm (Ngực)' },
  { cm: 150, label: '150 cm+ (Rất sâu)' },
];

const PEOPLE_PRESETS = [1, 2, 4, 8];

export const MobileSOSModal: React.FC<MobileSOSModalProps> = ({
  isOpen,
  onClose,
  zones = [],
  onSubmit,
}) => {
  const [need, setNeed] = useState<string>('EVACUATION');
  const [depth, setDepth] = useState<number>(60);
  const [people, setPeople] = useState<number>(2);
  const [note, setNote] = useState<string>('');
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null);

  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locating, setLocating] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const acquireGps = useCallback(() => {
    setGpsError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Thiết bị không hỗ trợ GPS vệ tinh.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        // Fall back to first available zone center or default Hanoi coords
        const fallbackZone = zones[0];
        if (fallbackZone) {
          setCoords({ lat: fallbackZone.center_lat, lng: fallbackZone.center_lng });
          setGpsError(`Không lấy được GPS (${err.message}). Đang dùng vị trí vùng ${fallbackZone.name}.`);
        } else {
          setCoords({ lat: 21.0285, lng: 105.8542 });
          setGpsError('Không lấy được GPS vệ tinh. Hãy kiểm tra quyền vị trí trên điện thoại.');
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }, [zones]);

  // Trigger GPS acquisition automatically on open
  useEffect(() => {
    if (isOpen) {
      acquireGps();
    }
  }, [isOpen, acquireGps]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto({ name: file.name, dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coords) {
      setError('Vui lòng đợi lấy tọa độ GPS hoặc chọn khu vực cứu hộ.');
      return;
    }
    const finalDescription = note.trim()
      ? note.trim()
      : `Báo cứu hộ khẩn cấp 1-chạm (mực nước ${depth}cm, ${people} người cần hỗ trợ)`;

    const descCheck = validateReportDescription(finalDescription);
    if (descCheck) {
      setError(descCheck);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        lat: coords.lat,
        lng: coords.lng,
        depth_cm: depth,
        need_type: need,
        people_affected: people,
        description: finalDescription,
        evidence_filename: photo?.name,
        evidence_data_url: photo?.dataUrl,
      });

      speakVoiceAlert('Đã phát tín hiệu cứu hộ khẩn cấp tại vị trí của bạn.', { urgent: true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được tín hiệu SOS. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sos-title"
        className="w-full max-w-lg rounded-t-2xl sm:rounded-xl border border-crit/40 bg-sheet shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in slide-in-from-bottom duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-crit text-white">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 animate-pulse text-white" aria-hidden="true" />
            <div>
              <h2 id="sos-title" className="text-base font-bold tracking-tight text-white">
                BÁO NGẬP KHẨN CẤP (1-CHẠM GPS)
              </h2>
              <p className="text-xs text-white/85">Phát tín hiệu trực tiếp đến đội cứu hộ gần nhất</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng SOS"
            className="rounded p-1 text-white/80 hover:bg-black/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded border border-crit bg-crit-soft p-3 text-xs text-crit font-semibold">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* GPS Coordinate Display */}
          <div className="rounded-lg border border-line bg-sheet-2 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-ink-2 flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-river" /> Tọa độ vệ tinh GPS
              </span>
              <button
                type="button"
                onClick={acquireGps}
                disabled={locating}
                className="text-xs font-semibold text-river hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                {locating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang định vị...
                  </>
                ) : (
                  <>
                    <LocateFixed className="h-3.5 w-3.5" /> Lấy lại GPS
                  </>
                )}
              </button>
            </div>

            {coords ? (
              <div className="text-sm font-mono text-ink">
                <span>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
                {coords.accuracy !== undefined && (
                  <span className="text-xs font-sans text-ink-3 ml-2">(sai số ±{coords.accuracy}m)</span>
                )}
              </div>
            ) : (
              <div className="text-xs text-ink-3">Chưa có tọa độ GPS.</div>
            )}

            {gpsError && <p className="text-[11px] text-warn font-medium mt-1">{gpsError}</p>}
          </div>

          {/* Need Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-2 mb-2">
              Bạn cần hỗ trợ gì?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {NEEDS.map((item) => {
                const selected = need === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setNeed(item.id)}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs font-semibold transition ${
                      selected
                        ? 'border-river bg-river-soft text-river-2 shadow-xs'
                        : 'border-line bg-sheet text-ink hover:bg-sheet-2'
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {selected && <Check className="h-3.5 w-3.5 text-river" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Depth Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-2 mb-2">
              Mực nước hiện tại
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DEPTH_PRESETS.map((p) => {
                const selected = depth === p.cm;
                return (
                  <button
                    key={p.cm}
                    type="button"
                    onClick={() => setDepth(p.cm)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold text-center transition ${
                      selected
                        ? 'border-river bg-river-soft text-river-2 font-bold'
                        : 'border-line bg-sheet text-ink-2 hover:bg-sheet-2'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* People Count */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-2 mb-2">
              Số người bị cô lập / cần giúp đỡ
            </label>
            <div className="flex gap-2">
              {PEOPLE_PRESETS.map((count) => {
                const selected = people === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setPeople(count)}
                    className={`flex-1 rounded-lg border py-2 text-xs font-bold transition ${
                      selected
                        ? 'border-river bg-river-soft text-river-2'
                        : 'border-line bg-sheet text-ink-2 hover:bg-sheet-2'
                    }`}
                  >
                    {count === 8 ? '8+ người' : `${count} người`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Note */}
          <div>
            <label htmlFor="sos-note" className="block text-xs font-bold uppercase tracking-wider text-ink-2 mb-1">
              Ghi chú thêm (không bắt buộc)
            </label>
            <input
              id="sos-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Nhà cấp 4, có người già và trẻ nhỏ..."
              className="input text-xs"
              maxLength={200}
            />
          </div>

          {/* Photo input */}
          <div className="flex items-center gap-3">
            <label className="btn text-xs cursor-pointer flex items-center gap-1.5">
              <Camera className="h-4 w-4" />
              <span>{photo ? 'Đã chọn ảnh hiện trường' : 'Chụp / Tải ảnh nước ngập'}</span>
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
            </label>
            {photo && (
              <span className="text-xs text-safe font-medium truncate flex items-center gap-1">
                <Check className="h-3 w-3" /> {photo.name}
              </span>
            )}
          </div>

          {/* Submit Action */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting || !coords}
              className="btn btn-danger btn-lg w-full font-bold shadow-md flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>ĐANG PHÁT TÍN HIỆU CỨU NẠN...</span>
                </>
              ) : (
                <>
                  <Radio className="h-5 w-5 animate-pulse" />
                  <span>PHÁT TÍN HIỆU CỨU HỘ NGAY</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
