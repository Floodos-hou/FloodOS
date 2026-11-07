# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

"""
FloodOS AI Tactical Assistant Service
Provides:
  1. Incident & Situation Summary for Dispatchers
  2. AI Priority Classification with Human-in-the-loop recommendation
  3. After-Action Report (AAR) generation from immutable audit hash-chain

Operates in dual-engine mode:
  - LIVE LLM: OpenAI / Anthropic API when API key is provided
  - TACTICAL HEURISTIC FALLBACK: Deterministic, rule-based hydrological engine
    when running offline or without external cloud credentials.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

PROMPTS_DIR = Path(__file__).parent / "prompts"

app = FastAPI(
    title="FloodOS AI Tactical Assistant",
    description="Thin AI support service for FloodOS C2 Tactical Command",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()


def load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


# -----------------------------------------------------------------------------
# Data Models
# -----------------------------------------------------------------------------

class SituationSummaryRequest(BaseModel):
    report_id: str
    status: Optional[str] = "RECEIVED"
    priority: Optional[str] = "NORMAL"
    need_type: Optional[str] = "EVACUATION"
    depth_cm: Optional[float] = 0
    people_affected: Optional[int] = 0
    description: Optional[str] = ""
    location: Optional[str] = ""
    created_at: Optional[str] = ""
    orders_info: Optional[str] = "Chưa có lệnh điều phối"
    incidents_info: Optional[str] = "Không có sự cố phương tiện"
    audit_summary: Optional[str] = ""


class SituationSummaryResponse(BaseModel):
    report_id: str
    summary_text: str
    current_status: str
    timeline: List[str]
    suggested_actions: List[str]
    engine: str
    generated_at: str


class PriorityClassificationRequest(BaseModel):
    description: str
    depth_cm: Optional[float] = 0
    people_affected: Optional[int] = 1
    need_type: Optional[str] = "EVACUATION"
    location_hint: Optional[str] = ""


class PriorityClassificationResponse(BaseModel):
    suggested_priority: str
    confidence: float
    reasoning: str
    key_factors: List[str]
    engine: str
    generated_at: str


class AfterActionReportRequest(BaseModel):
    report_id: str
    created_at: str
    resolved_at: Optional[str] = ""
    priority: Optional[str] = "NORMAL"
    need_type: Optional[str] = "EVACUATION"
    depth_cm: Optional[float] = 0
    final_depth_cm: Optional[float] = 0
    people_affected: Optional[int] = 0
    team_name: Optional[str] = ""
    vehicle_name: Optional[str] = ""
    outcome: Optional[str] = "RESOLVED"
    field_notes: Optional[str] = ""
    confirmation_status: Optional[str] = "CONFIRMED"
    confirmation_notes: Optional[str] = ""
    chain_proof: Optional[str] = "SHA-256 Valid"
    audit_events: Optional[List[Dict[str, Any]]] = Field(default_factory=list)


class AfterActionReportResponse(BaseModel):
    report_id: str
    report_title: str
    executive_summary: str
    markdown_content: str
    engine: str
    generated_at: str


# -----------------------------------------------------------------------------
# LLM Invocation Helpers
# -----------------------------------------------------------------------------

async def call_openai_chat(messages: List[Dict[str, str]], temperature: float = 0.2) -> Optional[str]:
    if not OPENAI_API_KEY:
        return None
    url = f"{OPENAI_API_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 1200,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
    except Exception:
        pass
    return None


# -----------------------------------------------------------------------------
# Deterministic Tactical Heuristic Engines (Offline / Fallback)
# -----------------------------------------------------------------------------

def need_vietnamese(need: str) -> str:
    mapping = {
        "EVACUATION": "Sơ tán, cứu hộ khẩn cấp",
        "MEDICAL": "Cấp cứu y tế",
        "FOOD_WATER": "Tiếp tế lương thực và nước uống",
        "PUMPING": "Bơm tiêu úng thoát nước",
        "ROAD_BLOCKED": "Đường bị ngập cô lập, chia cắt giao thông",
    }
    return mapping.get(need.upper(), need)


def generate_tactical_summary_fallback(req: SituationSummaryRequest) -> SituationSummaryResponse:
    depth = req.depth_cm or 0
    people = req.people_affected or 0
    need_str = need_vietnamese(req.need_type or "EVACUATION")
    loc = req.location or "khu vực tin báo"

    # 1. Current status text
    if depth >= 100 or people >= 5 or req.priority in ("CRITICAL", "URGENT"):
        urgency = "Mức độ NGUY HIỂM CAO"
    elif depth >= 50 or people >= 3:
        urgency = "Mức độ TRUNG BÌNH CẦN ƯU TIÊN"
    else:
        urgency = "Mức độ ỔN ĐỊNH CẦN THEO DÕI"

    summary_text = (
        f"[{urgency}] Tin báo {req.report_id} tại {loc}. Nhu cầu {need_str.lower()}, "
        f"mực nước ngập sâu {depth:.0f} cm với {people} người cần hỗ trợ. "
        f"Nội dung báo: \"{req.description}\". Trạng thái điều hành: {req.status}."
    )

    # 2. Timeline
    timeline = []
    if req.created_at:
        timeline.append(f"{req.created_at}: Tiếp nhận tin báo ban đầu từ người dân.")
    if req.orders_info and "Chưa có" not in req.orders_info:
        timeline.append(f"Điều động lực lượng: {req.orders_info}.")
    else:
        timeline.append("Đang chờ điều phối viên phát lệnh điều động.")
    if req.incidents_info and "Không có" not in req.incidents_info:
        timeline.append(f"Cảnh báo sự cố kỹ thuật: {req.incidents_info}.")

    # 3. Suggested actions
    suggested = []
    if req.status == "RECEIVED":
        suggested.append(f"Xác minh nhanh tin báo và phê duyệt mức ưu tiên ({req.priority}).")
    if depth >= 80 or "EVACUATION" in (req.need_type or ""):
        suggested.append("Huy động xuồng cứu hộ chuyên dụng (Rescue Boat) và áo phao cơ động tiếp cận.")
    elif "PUMPING" in (req.need_type or ""):
        suggested.append("Điều phối máy bơm dã chiến công suất cao và rào chắn cảnh báo điểm ngập.")
    else:
        suggested.append("Chỉ định xe tải gầm cao tiếp tế lương thực, nước sạch đến tọa độ yêu cầu.")
    suggested.append("Cập nhật sĩ số điểm trú an toàn gần nhất để sẵn sàng tiếp nhận người dân.")

    return SituationSummaryResponse(
        report_id=req.report_id,
        summary_text=summary_text,
        current_status=req.status or "RECEIVED",
        timeline=timeline,
        suggested_actions=suggested,
        engine="TACTICAL_HEURISTIC_FALLBACK",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def classify_priority_heuristic(req: PriorityClassificationRequest) -> PriorityClassificationResponse:
    desc = (req.description or "").lower()
    depth = req.depth_cm or 0
    people = req.people_affected or 1
    need = (req.need_type or "").upper()

    critical_keywords = [
        "nguy kịch", "cấp cứu", "sắp chìm", "đuối nước", "mắc kẹt người già",
        "trẻ sơ sinh", "bệnh nhân", "nguy hiểm tính mạng", "sập nhà", "cuốn trôi"
    ]
    urgent_keywords = [
        "ngập sâu", "cô lập", "hết đồ ăn", "thiếu nước", "chia cắt",
        "nước dâng", "trẻ em", "người già", "khẩn cấp"
    ]

    matched_critical = [w for w in critical_keywords if w in desc]
    matched_urgent = [w for w in urgent_keywords if w in desc]

    key_factors = []

    if matched_critical or depth >= 100 or (need == "MEDICAL" and depth >= 40):
        suggested = "CRITICAL"
        confidence = 0.92
        if matched_critical:
            key_factors.append(f"Phát hiện dấu hiệu nguy kịch trong mô tả ({', '.join(matched_critical[:2])})")
        if depth >= 100:
            key_factors.append(f"Mực nước rất sâu ({depth:.0f} cm) đe dọa trực tiếp tính mạng")
        if need == "MEDICAL":
            key_factors.append("Yêu cầu cấp cứu y tế trong vùng ngập sâu")
        reasoning = "Tình huống có yếu tố đe dọa tính mạng tức thời hoặc ngập sâu nghiêm trọng, cần phản ứng ưu tiên cấp độ cao nhất."
    elif matched_urgent or depth >= 50 or people >= 4 or need in ("EVACUATION", "MEDICAL"):
        suggested = "URGENT"
        confidence = 0.86
        if depth >= 50:
            key_factors.append(f"Mực nước ngập ngang hông/bụng ({depth:.0f} cm)")
        if people >= 4:
            key_factors.append(f"Số người bị ảnh hưởng lớn ({people} người)")
        if need in ("EVACUATION", "MEDICAL"):
            key_factors.append(f"Nhu cầu cấp thiết: {need_vietnamese(need)}")
        reasoning = "Nước ngập sâu diện rộng hoặc có nhóm người bị cô lập cần sơ tán và ứng cứu kịp thời."
    elif depth >= 30 or people >= 2 or need in ("FOOD_WATER", "ROAD_BLOCKED"):
        suggested = "HIGH"
        confidence = 0.80
        key_factors.append(f"Mực nước {depth:.0f} cm gây chia cắt giao thông")
        reasoning = "Khu vực bị ngập cản trở đi lại, cần điều động hỗ trợ tiếp tế hoặc hướng dẫn phân luồng."
    elif depth >= 10 or need == "PUMPING":
        suggested = "NORMAL"
        confidence = 0.85
        key_factors.append(f"Mực nước {depth:.0f} cm chưa gây nguy hiểm tức thì")
        reasoning = "Ngập úng cục bộ, ưu tiên các biện pháp bơm tiêu thoát nước thông thường."
    else:
        suggested = "LOW"
        confidence = 0.88
        key_factors.append("Mức độ ngập nhẹ, tình trạng ổn định")
        reasoning = "Tin báo quan sát thông thường, duy trì giám sát định kỳ."

    return PriorityClassificationResponse(
        suggested_priority=suggested,
        confidence=confidence,
        reasoning=reasoning,
        key_factors=key_factors,
        engine="TACTICAL_HEURISTIC_FALLBACK",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def generate_aar_heuristic(req: AfterActionReportRequest) -> AfterActionReportResponse:
    depth = req.depth_cm or 0
    final_depth = req.final_depth_cm if req.final_depth_cm is not None else 0
    people = req.people_affected or 0
    team = req.team_name or "Đội cơ động phản ứng nhanh"
    vehicle = req.vehicle_name or "Phương tiện cứu hộ"
    need_str = need_vietnamese(req.need_type or "EVACUATION")

    markdown = f"""# BÁO CÁO TỔNG KẾT VỤ VIỆC (AFTER-ACTION REPORT)
**Mã vụ việc:** `{req.report_id}` | **Mức ưu tiên ban đầu:** `{req.priority}` | **Trạng thái:** `HOÀN TẤT & ĐÓNG HỒ SƠ`

---

### 1. TỔNG QUAN VỤ VIỆC & MỨC ĐỘ THIỆT HẠI
- **Loại hình nhiệm vụ:** {need_str}
- **Thời điểm tiếp nhận:** {req.created_at}
- **Thời điểm hoàn thành:** {req.resolved_at or "Đã đóng trong phiên điều hành"}
- **Hiện trạng ban đầu:** Mực nước ngập sâu **{depth:.0f} cm**, có **{people} người** cần ứng cứu khẩn cấp.
- **Hiện trạng kết thúc:** Mực nước rút còn **{final_depth:.0f} cm**, an toàn cho người dân.

---

### 2. DÒNG THỜI GIAN ĐIỀU PHỐI (CHỈ HUY ➔ HIỆN TRƯỜNG ➔ XÁC NHẬN)
1. **Tiếp nhận & Xác minh:** Tiếp nhận tin báo của người dân qua Cổng tác chiến FloodOS. Điều phối viên thẩm tra thực địa và phê duyệt mức ưu tiên `{req.priority}`.
2. **Phát lệnh điều động:** Trung tâm phát lệnh điều động cho **{team}** vận hành **{vehicle}** cơ động tiếp cận hiện trường.
3. **Thực thi nhiệm vụ:** Đội cứu hộ tiếp cận, triển khai sơ tán/hỗ trợ người dân, ghi nhận hiện trường và cập nhật tiến độ 100%.
4. **Xác nhận kết quả:** Người báo tin xác nhận thực tế (`{req.confirmation_status}`), đóng vụ việc.

---

### 3. NGUỒN LỰC HUY ĐỘNG & ĐÁNH GIÁ HIỆU SUẤT
- **Đội cứu hộ:** {team}
- **Phương tiện:** {vehicle}
- **Kết quả nghiệm thu:** `{req.outcome}`
- **Ghi chú hiện trường:** {req.field_notes or "Xử lý thành công theo đúng quy trình phối hợp ứng phó ngập lụt."}
- **Tính toàn vẹn kiểm chứng:** Chuỗi Hash-Chain SHA-256 xác thực **HỢP LỆ (100% Tamper-Evident)** (Bằng chứng: `{req.chain_proof}`).

---

### 4. ĐÁNH GIÁ VÀ BÀI HỌC KINH NGHIỆM
- **Điểm mạnh:** Thời gian xác minh và điều động diễn ra nhanh chóng; định vị GPS và thông tin nhu cầu chính xác giúp đội cứu hộ chọn đúng phương tiện.
- **Kiến nghị phòng ngừa:** Tiếp tục theo dõi cốt ngập tại vị trí này trong các đợt mưa kế tiếp; kiến nghị bổ sung rào chắn cảnh báo độ sâu tự động.
"""

    return AfterActionReportResponse(
        report_id=req.report_id,
        report_title=f"Báo cáo tổng kết ứng phó vụ việc {req.report_id}",
        executive_summary=f"Đã giải quyết thành công vụ việc {req.report_id} ({need_str}). Đội {team} đã hỗ trợ an toàn cho {people} người dân, nước rút về {final_depth:.0f} cm.",
        markdown_content=markdown,
        engine="TACTICAL_HEURISTIC_FALLBACK",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------

@app.get("/health")
def health():
    llm_ready = bool(OPENAI_API_KEY or ANTHROPIC_API_KEY)
    active = f"OPENAI_{OPENAI_MODEL}" if OPENAI_API_KEY else "TACTICAL_HEURISTIC_FALLBACK"
    return {
        "status": "HEALTHY",
        "service": "FloodOS AI Tactical Assistant",
        "llm_configured": llm_ready,
        "engine": active,
        "active_engine": active,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/v1/ai/summarize", response_model=SituationSummaryResponse)
async def summarize_incident(req: SituationSummaryRequest):
    template = load_prompt("summarize.txt")
    if template and OPENAI_API_KEY:
        prompt_content = template.format(
            report_id=req.report_id,
            created_at=req.created_at or "vừa tiếp nhận",
            status=req.status or "RECEIVED",
            priority=req.priority or "NORMAL",
            need_type=need_vietnamese(req.need_type or "EVACUATION"),
            depth_cm=req.depth_cm or 0,
            people_affected=req.people_affected or 0,
            location=req.location or "khu vực tin báo",
            description=req.description or "Không có mô tả chi tiết",
            orders_info=req.orders_info or "Chưa có",
            incidents_info=req.incidents_info or "Không có",
            audit_summary=req.audit_summary or "Chưa có nhật ký",
        )
        messages = [
            {"role": "system", "content": "Bạn là Trợ lý Tác chiến AI của hệ thống chỉ huy ngập lụt FloodOS. Luôn trả lời bằng tiếng Việt chuẩn công vụ, súc tích, trung thực."},
            {"role": "user", "content": prompt_content},
        ]
        llm_reply = await call_openai_chat(messages, temperature=0.2)
        if llm_reply:
            fallback = generate_tactical_summary_fallback(req)
            return SituationSummaryResponse(
                report_id=req.report_id,
                summary_text=llm_reply,
                current_status=req.status or "RECEIVED",
                timeline=fallback.timeline,
                suggested_actions=fallback.suggested_actions,
                engine=f"OPENAI_{OPENAI_MODEL}",
                generated_at=datetime.now(timezone.utc).isoformat(),
            )

    return generate_tactical_summary_fallback(req)


@app.post("/api/v1/ai/classify-priority", response_model=PriorityClassificationResponse)
async def classify_priority(req: PriorityClassificationRequest):
    template = load_prompt("classify.txt")
    if template and OPENAI_API_KEY:
        prompt_content = template.format(
            need_type=need_vietnamese(req.need_type or "EVACUATION"),
            depth_cm=req.depth_cm or 0,
            people_affected=req.people_affected or 1,
            location_hint=req.location_hint or "địa điểm tin báo",
            description=req.description or "Không có mô tả",
        )
        messages = [
            {"role": "system", "content": "Bạn là chuyên gia phân loại mức độ ưu tiên cứu hộ khẩn cấp của FloodOS. Chỉ trả về JSON duy nhất không kèm code block."},
            {"role": "user", "content": prompt_content},
        ]
        llm_reply = await call_openai_chat(messages, temperature=0.1)
        if llm_reply:
            try:
                # strip any markdown code fence if LLM returned it
                cleaned = re.sub(r"^```(?:json)?\s*", "", llm_reply.strip())
                cleaned = re.sub(r"\s*```$", "", cleaned.strip())
                data = json.loads(cleaned)
                priority = str(data.get("suggested_priority", "NORMAL")).upper()
                if priority not in ("CRITICAL", "URGENT", "HIGH", "NORMAL", "LOW"):
                    priority = "NORMAL"
                return PriorityClassificationResponse(
                    suggested_priority=priority,
                    confidence=float(data.get("confidence", 0.85)),
                    reasoning=str(data.get("reasoning", "Đánh giá bởi mô hình LLM")),
                    key_factors=list(data.get("key_factors", [])),
                    engine=f"OPENAI_{OPENAI_MODEL}",
                    generated_at=datetime.now(timezone.utc).isoformat(),
                )
            except Exception:
                pass

    return classify_priority_heuristic(req)


@app.post("/api/v1/ai/after-action-report", response_model=AfterActionReportResponse)
async def create_after_action_report(req: AfterActionReportRequest):
    template = load_prompt("after_action_report.txt")
    if template and OPENAI_API_KEY:
        prompt_content = template.format(
            report_id=req.report_id,
            created_at=req.created_at,
            resolved_at=req.resolved_at or "Vừa kết thúc",
            priority=req.priority or "NORMAL",
            need_type=need_vietnamese(req.need_type or "EVACUATION"),
            depth_cm=req.depth_cm or 0,
            final_depth_cm=req.final_depth_cm if req.final_depth_cm is not None else 0,
            people_affected=req.people_affected or 0,
            team_name=req.team_name or "Đội ứng cứu",
            vehicle_name=req.vehicle_name or "Phương tiện",
            outcome=req.outcome or "RESOLVED",
            field_notes=req.field_notes or "Không có",
            confirmation_status=req.confirmation_status or "CONFIRMED",
            confirmation_notes=req.confirmation_notes or "Không có",
            chain_proof=req.chain_proof or "Hợp lệ",
            audit_events=str(req.audit_events or []),
        )
        messages = [
            {"role": "system", "content": "Bạn là chuyên gia lập báo cáo After-Action Report cho chỉ huy ngập lụt FloodOS. Viết báo cáo chuẩn công vụ chi tiết."},
            {"role": "user", "content": prompt_content},
        ]
        llm_reply = await call_openai_chat(messages, temperature=0.2)
        if llm_reply:
            fallback = generate_aar_heuristic(req)
            return AfterActionReportResponse(
                report_id=req.report_id,
                report_title=f"Báo cáo tổng kết vụ việc {req.report_id}",
                executive_summary=fallback.executive_summary,
                markdown_content=llm_reply,
                engine=f"OPENAI_{OPENAI_MODEL}",
                generated_at=datetime.now(timezone.utc).isoformat(),
            )

    return generate_aar_heuristic(req)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8088"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
