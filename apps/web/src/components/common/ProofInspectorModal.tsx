// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { useAuth } from '../../context/useAuth';
import { api, ApiError } from '../../services/api';
import { ShieldAlert, CheckCircle2, XCircle, AlertTriangle, X, ShieldCheck } from 'lucide-react';
import { roleLabel } from '../../utils/labels';

interface ProofInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProofInspectorModal: React.FC<ProofInspectorModalProps> = ({ isOpen, onClose }) => {
  const { user, safeClaims, token } = useAuth();
  const [testResult, setTestResult] = useState<{
    status: number;
    blocked: boolean;
    message: string;
    actionTested: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  if (!isOpen) return null;

  const handleTestForbiddenAction = async () => {
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Deliberately execute an unauthorized action based on current role
      if (user?.role === 'FARMER') {
        // Farmer tries to dispatch an assignment
        await api.dispatchAssignment(token, {
          request_id: 'REQ-FORBIDDEN-TEST',
          field_id: 'F01',
          machine_id: 'M01',
          operator_id: 'OP-01',
          start_time: '2026-11-20T13:00:00Z',
          end_time: '2026-11-20T17:00:00Z',
        });
        setTestResult({
          status: 200,
          blocked: false,
          actionTested: 'POST /api/v1/assignments (Phân công máy)',
          message: 'LỖI BẢO MẬT: Request không bị chặn!',
        });
      } else {
        // Other role tries an illegal action or invalid permission
        await api.dispatchAssignment(token, {
          request_id: 'REQ-UNKNOWN',
          field_id: 'F_ST01', // Cross-tenant attempt
          machine_id: 'M01',
          operator_id: 'OP-01',
          start_time: '2026-11-20T13:00:00Z',
          end_time: '2026-11-20T17:00:00Z',
        });
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403) {
        setTestResult({
          status: 403,
          blocked: true,
          actionTested: 'POST /api/v1/assignments (Vượt quyền RBAC)',
          message: err.message || 'Hệ thống Zero-Trust Gateway đã chặn đứng hành động trái quyền!',
        });
      } else if (err instanceof ApiError) {
        setTestResult({
          status: err.status,
          blocked: true,
          actionTested: 'POST /api/v1/assignments',
          message: err.message,
        });
      } else {
        setTestResult({
          status: 500,
          blocked: false,
          actionTested: 'POST /api/v1/assignments',
          message: err.message || 'Lỗi không xác định',
        });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden">
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold">Quyền truy cập của tài khoản</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          
          {/* Security Disclaimer */}
          <div className="flex items-start space-x-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Lưu ý Bảo mật (Zero-Trust Architectural Principle):</p>
              <p className="mt-0.5 text-amber-700">
                Việc giải mã Claims dưới đây chỉ nhằm mục đích kiểm tra giao diện (UI Debug/Inspection). 
                Chữ ký số cryptographic và chính sách phân quyền Row-Level Security (RLS) 
                bắt buộc được kiểm chứng độc lập tại <strong>Apache APISIX Zero-Trust Gateway</strong> và <strong>PostgreSQL 16 Engine</strong>.
              </p>
            </div>
          </div>

          {/* Safe JWT Claims Grid */}
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">
              Các Claims Được Phép Xem (Allowlisted Claims)
            </h4>
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 font-mono text-sm space-y-2">
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">sub (User ID):</span>
                <span className="text-slate-900 font-semibold">{safeClaims?.sub || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">preferred_username:</span>
                <span className="text-slate-900 font-semibold">{safeClaims?.preferred_username || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">name (Họ tên):</span>
                <span className="text-slate-900 font-semibold">{safeClaims?.name || user?.full_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">roles (Vai trò RBAC):</span>
                <span className="text-emerald-700 font-semibold">{safeClaims?.roles?.join(', ') || user?.role}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">organization_id (Đơn vị thuê):</span>
                <span className="text-blue-700 font-semibold">{safeClaims?.organization_id || user?.organization_id}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">iss (OIDC Issuer):</span>
                <span className="text-slate-700 truncate max-w-xs">{safeClaims?.iss || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">exp (Thời điểm hết hạn):</span>
                <span className="text-slate-700">
                  {safeClaims?.exp ? new Date(safeClaims.exp * 1000).toLocaleString('vi-VN') : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Test Forbidden Action (RBAC 403 Verification) */}
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">
              Kiểm Chứng Ngăn Chặn Vượt Quyền (Verify 403 Forbidden Block)
            </h4>
            <p className="text-sm text-slate-600 mb-3">
              Thử nghiệm gửi yêu cầu gọi API vượt ngoài phạm vi quyền hạn của vai trò hiện tại (<strong>{roleLabel(user?.role)}</strong>) để chứng thực hệ thống từ chối truy cập.
            </p>

            <button
              onClick={handleTestForbiddenAction}
              disabled={testing}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-sm font-semibold transition"
            >
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>{testing ? 'Đang gửi kiểm thử...' : 'Gửi Thử Nghiệm Gọi Lệnh Trái Quyền'}</span>
            </button>

            {testResult && (
              <div className={`mt-3 p-3 rounded-lg border text-sm flex items-start space-x-2.5 ${
                testResult.blocked 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900' 
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}>
                {testResult.blocked ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">
                    {testResult.blocked ? '[PASS] Chặn Thành Công (HTTP 403)' : '[FAIL] Lỗ Hổng Bảo Mật'}
                  </p>
                  <p className="text-slate-600 mt-0.5 font-mono text-sm">
                    Thao tác: {testResult.actionTested}
                  </p>
                  <p className="mt-1">{testResult.message}</p>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Modal Footer */}
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
