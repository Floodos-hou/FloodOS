// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import { api } from '../../services/api';
import { formatLocalTime } from '../../utils/dateTime';
import { GitCommit, ShieldCheck, X, Clock, User } from 'lucide-react';
import { TraceLink } from './TraceLink';

interface DataLineageModalProps {
  isOpen: boolean;
  onClose: () => void;
  correlationId?: string;
}

export const DataLineageModal: React.FC<DataLineageModalProps> = ({
  isOpen,
  onClose,
  correlationId = 'CORR-GOLDEN-F03',
}) => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [lineageData, setLineageData] = useState<{
    correlation_id: string;
    chain_proof: {
      chain_valid: boolean;
      total_blocks: number;
      latest_hash: string;
      algorithm: string;
    };
    lineage_steps: Array<{
      seq_no: number;
      event_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      actor_user_id: string;
      actor_role: string;
      created_at: string;
      record_hash: string;
    }>;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !token) return;
    let cancelled = false;
    // Defer the loading flag so it is not set synchronously inside the effect body
    const t = window.setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    api.getLineage(token, correlationId)
      .then((data: any) => { if (!cancelled) setLineageData(data); })
      .catch((err) => console.error('Failed to fetch lineage', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [isOpen, token, correlationId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <GitCommit className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold">Lịch sử thay đổi dữ liệu</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          
          {/* Proof Badge */}
          {lineageData?.chain_proof && (
            <div className={`p-4 rounded-xl border flex items-center justify-between ${
              lineageData.chain_proof.chain_valid 
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950' 
                : 'bg-rose-50 border-rose-300 text-rose-950'
            }`}>
              <div className="flex items-center space-x-3">
                <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm tracking-wide">
                      {lineageData.chain_proof.chain_valid 
                        ? 'Dữ liệu nguyên vẹn, không bị sửa' 
                        : 'Cảnh báo: dữ liệu có dấu hiệu bị sửa'}
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-semibold font-mono">
                      {lineageData.chain_proof.algorithm}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1 font-mono">
                    Mã theo dõi: <strong>{lineageData.correlation_id}</strong> · Số bản ghi: {lineageData.chain_proof.total_blocks}
                  </p>
                  <div className="mt-3"><TraceLink traceId={String(lineageData.correlation_id)} /></div>
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <span className="text-sm text-slate-500 uppercase tracking-wider block">Mã xác thực mới nhất</span>
                <span className="font-mono text-sm text-slate-700 bg-white px-2 py-1 rounded border border-slate-200">
                  {lineageData.chain_proof.latest_hash?.substring(0, 16)}...
                </span>
              </div>
            </div>
          )}

          {/* Lineage Steps Timeline */}
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
              Ai đã làm gì, theo thứ tự thời gian
            </h4>

            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500">
                Đang kiểm tra dữ liệu…
              </div>
            ) : lineageData?.lineage_steps && lineageData.lineage_steps.length > 0 ? (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {lineageData.lineage_steps.map((step, idx) => (
                  <div key={step.event_id || idx} className="relative group">
                    <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-white border-2 border-emerald-600 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-emerald-600" />
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-bold text-slate-900 font-mono">
                          #{step.seq_no} · {step.action}
                        </span>
                        <span className="text-slate-400 text-sm flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatLocalTime(step.created_at)}</span>
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 text-sm text-slate-600">
                        <span className="inline-flex items-center space-x-1 bg-white px-2 py-0.5 rounded border border-slate-200 font-medium">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{step.actor_user_id} ({step.actor_role})</span>
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="font-mono text-slate-700">
                          {step.entity_type}: {step.entity_id}
                        </span>
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-slate-200 text-sm font-mono text-slate-400 truncate">
                        Block Hash: {step.record_hash}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-slate-400">
                Chưa có bản ghi phả hệ cho mã giao dịch này.
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
};
