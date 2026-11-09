# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
import pytest
from app import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "HEALTHY"
    assert "llm_configured" in data
    assert "engine" in data


def test_situation_summary_heuristic():
    payload = {
        "report_id": "RPT-TEST-001",
        "status": "IN_PROGRESS",
        "priority": "CRITICAL",
        "need_type": "EVACUATION",
        "depth_cm": 120.0,
        "people_affected": 4,
        "description": "Nước ngập ngang ngực, có 2 người già và 1 trẻ nhỏ mắc kẹt trên gác xép.",
        "location": "Xã Hải Tân, Huyện Hải Lăng, Quảng Trị",
        "created_at": "2026-11-09T08:00:00Z",
        "orders_info": "Đội Cứu hộ 1 đang di chuyển bằng Xuồng 02",
        "incidents_info": "Không có sự cố phương tiện",
    }
    response = client.post("/api/v1/ai/summarize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["report_id"] == "RPT-TEST-001"
    assert "120" in data["summary_text"]
    assert "NGUY HIỂM CAO" in data["summary_text"]
    assert len(data["timeline"]) >= 1
    assert len(data["suggested_actions"]) >= 1
    assert data["engine"] in ("TACTICAL_HEURISTIC_FALLBACK", "OPENAI_gpt-4o-mini")


def test_classify_priority_critical_keyword():
    payload = {
        "description": "Nhà sập, có người già đang cấp cứu nguy kịch cần sơ tán gấp!",
        "depth_cm": 90.0,
        "people_affected": 3,
        "need_type": "MEDICAL",
        "location_hint": "Thôn Đông, Lệ Thủy",
    }
    response = client.post("/api/v1/ai/classify-priority", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["suggested_priority"] == "CRITICAL"
    assert data["confidence"] >= 0.8
    assert len(data["reasoning"]) > 0
    assert len(data["key_factors"]) > 0


def test_classify_priority_normal():
    payload = {
        "description": "Nước bắt đầu mấp mé sân, xin theo dõi giúp",
        "depth_cm": 15.0,
        "people_affected": 1,
        "need_type": "PUMPING",
        "location_hint": "Khu dân cư Hải Lăng",
    }
    response = client.post("/api/v1/ai/classify-priority", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["suggested_priority"] in ("LOW", "NORMAL")
    assert data["confidence"] > 0.5


def test_after_action_report():
    payload = {
        "report_id": "RPT-DONE-999",
        "created_at": "2026-11-09T06:00:00Z",
        "resolved_at": "2026-11-09T09:30:00Z",
        "priority": "URGENT",
        "need_type": "EVACUATION",
        "depth_cm": 85.0,
        "final_depth_cm": 30.0,
        "people_affected": 5,
        "team_name": "Đội Cứu nạn Đặc nhiệm Hải Lăng",
        "vehicle_name": "Xuồng Composite X03",
        "outcome": "RESOLVED",
        "field_notes": "Đã đưa 5 người dân đến điểm sơ tán Trường Tiểu học Hải Tân an toàn.",
        "confirmation_status": "CONFIRMED",
        "confirmation_notes": "Chính quyền xã đã ký biên bản bàn giao.",
        "chain_proof": "valid_sha256_hash_block_abc123",
        "audit_events": [
            {"event": "REPORT_CREATED", "timestamp": "2026-11-09T06:00:00Z"},
            {"event": "DISPATCH_ASSIGNED", "timestamp": "2026-11-09T06:20:00Z"},
            {"event": "RESCUE_COMPLETED", "timestamp": "2026-11-09T09:30:00Z"}
        ]
    }
    response = client.post("/api/v1/ai/after-action-report", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["report_id"] == "RPT-DONE-999"
    assert "Báo cáo tổng kết" in data["report_title"]
    assert "TỔNG QUAN VỤ VIỆC" in data["markdown_content"]
    assert "Đội Cứu nạn Đặc nhiệm Hải Lăng" in data["markdown_content"]
    assert "valid_sha256_hash_block_abc123" in data["markdown_content"]
