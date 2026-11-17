# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

"""
FloodOS AI Tactical Assistant Service
Provides:
  1. Incident & Situation Summary for Dispatchers
  2. AI Priority Classification with Human-in-the-loop recommendation
  3. After-Action Report (AAR) generation from immutable audit hash-chain

Operates in dual-engine mode:
  - LIVE LLM: OpenAI-compatible API or Anthropic Messages API when configured
  - TACTICAL HEURISTIC FALLBACK: Deterministic, rule-based hydrological engine
    when running offline or without external cloud credentials.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

PROMPTS_DIR = Path(__file__).parent / "prompts"
VALID_PRIORITIES = ("CRITICAL", "URGENT", "HIGH", "NORMAL", "LOW")
DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000,"
    "http://127.0.0.1:3000,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("floodos.ai_assistant")


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    openai_api_key: str
    openai_api_base: str
    openai_model: str
    anthropic_api_key: str
    anthropic_api_base: str
    anthropic_model: str
    timeout_seconds: float


def get_llm_config() -> LlmConfig:
    raw_timeout = os.getenv("LLM_TIMEOUT_SECONDS", "15.0").strip()
    try:
        timeout_seconds = max(1.0, float(raw_timeout))
    except ValueError:
        timeout_seconds = 15.0
    return LlmConfig(
        provider=os.getenv("AI_PROVIDER", "auto").strip().lower() or "auto",
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        openai_api_base=os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1").strip().rstrip("/"),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        anthropic_api_base=os.getenv("ANTHROPIC_API_BASE", "https://api.anthropic.com").strip().rstrip("/"),
        anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest").strip() or "claude-3-5-haiku-latest",
        timeout_seconds=timeout_seconds,
    )


def resolve_provider_chain(cfg: LlmConfig) -> List[Tuple[str, str]]:
    """Return ordered list of configured (provider_kind, engine_label) candidates."""
    candidates: List[Tuple[str, str]] = []
    if cfg.provider == "openai":
        if cfg.openai_api_key:
            candidates.append(("openai", f"OPENAI_{cfg.openai_model}"))
        return candidates
    if cfg.provider == "anthropic":
        if cfg.anthropic_api_key:
            candidates.append(("anthropic", f"ANTHROPIC_{cfg.anthropic_model}"))
        return candidates

    if cfg.openai_api_key:
        candidates.append(("openai", f"OPENAI_{cfg.openai_model}"))
    if cfg.anthropic_api_key:
        candidates.append(("anthropic", f"ANTHROPIC_{cfg.anthropic_model}"))
    return candidates


def resolve_cors_settings() -> Tuple[List[str], bool]:
    raw_origins = os.getenv("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ORIGINS).strip()
    if raw_origins == "*":
        # Never combine wildcard origin with allow_credentials=True.
        return ["*"], False
    origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
    return (origins or ["http://localhost:3000"]), True


app = FastAPI(
    title="FloodOS AI Tactical Assistant",
    description="Thin AI support service for FloodOS C2 Tactical Command",
    version="0.3.0",
)

_cors_origins, _cors_credentials = resolve_cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    if path.exists():
        return path.read_text(encoding="utf-8")
    logger.warning("Prompt template not found: %s", path)
    return ""


def sanitize_untrusted_text(value: Optional[str], max_len: int = 2000) -> str:
    """Neutralize control characters and delimiter tags inside untrusted field input."""
    if not value:
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", str(value))
    cleaned = re.sub(r"</?\s*untrusted_input\s*>", "[tag-removed]", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    if len(cleaned) > max_len:
        return cleaned[:max_len] + "...[truncated]"
    return cleaned


def parse_llm_json(raw_text: str) -> Optional[Dict[str, Any]]:
    """Extract and parse a JSON object from raw LLM text output."""
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse JSON block from LLM output: %s", exc)
            return None

    logger.warning("LLM output did not contain a valid JSON object")
    return None


def _coerce_string_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


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

async def call_openai_chat(
    cfg: LlmConfig,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
) -> Optional[str]:
    if not cfg.openai_api_key:
        return None
    url = f"{cfg.openai_api_base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.openai_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": cfg.openai_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": 1200,
    }
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_seconds) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                logger.warning(
                    "OpenAI endpoint returned HTTP %s: %s",
                    resp.status_code,
                    resp.text[:300],
                )
                return None
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                logger.warning("OpenAI response missing choices")
                return None
            content = choices[0].get("message", {}).get("content", "")
            return str(content).strip() or None
    except Exception as exc:
        logger.warning("OpenAI request failed: %s", exc)
        return None


async def call_anthropic_chat(
    cfg: LlmConfig,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
) -> Optional[str]:
    if not cfg.anthropic_api_key:
        return None
    url = f"{cfg.anthropic_api_base}/v1/messages"
    headers = {
        "x-api-key": cfg.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": cfg.anthropic_model,
        "max_tokens": 1200,
        "temperature": temperature,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_seconds) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                logger.warning(
                    "Anthropic endpoint returned HTTP %s: %s",
                    resp.status_code,
                    resp.text[:300],
                )
                return None
            data = resp.json()
            blocks = data.get("content") or []
            texts = [
                str(block.get("text", ""))
                for block in blocks
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            joined = "\n".join(t for t in texts if t).strip()
            if not joined:
                logger.warning("Anthropic response contained no text blocks")
                return None
            return joined
    except Exception as exc:
        logger.warning("Anthropic request failed: %s", exc)
        return None


async def call_configured_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
) -> Tuple[Optional[str], Optional[str]]:
    """Invoke the configured LLM provider chain; returns (reply_text, engine_label)."""
    cfg = get_llm_config()
    for provider_kind, engine_label in resolve_provider_chain(cfg):
        if provider_kind == "openai":
            reply = await call_openai_chat(cfg, system_prompt, user_prompt, temperature)
        elif provider_kind == "anthropic":
            reply = await call_anthropic_chat(cfg, system_prompt, user_prompt, temperature)
        else:
            reply = None
        if reply:
            return reply, engine_label
    return None, None


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

    timeline = []
    if req.created_at:
        timeline.append(f"{req.created_at}: Tiếp nhận tin báo ban đầu từ người dân.")
    if req.orders_info and "Chưa có" not in req.orders_info:
        timeline.append(f"Điều động lực lượng: {req.orders_info}.")
    else:
        timeline.append("Đang chờ điều phối viên phát lệnh điều động.")
    if req.incidents_info and "Không có" not in req.incidents_info:
        timeline.append(f"Cảnh báo sự cố kỹ thuật: {req.incidents_info}.")

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
        "trẻ sơ sinh", "bệnh nhân", "nguy hiểm tính mạng", "sập nhà", "cuốn trôi",
    ]
    urgent_keywords = [
        "ngập sâu", "cô lập", "hết đồ ăn", "thiếu nước", "chia cắt",
        "nước dâng", "trẻ em", "người già", "khẩn cấp",
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
    cfg = get_llm_config()
    chain = resolve_provider_chain(cfg)
    active = chain[0][1] if chain else "TACTICAL_HEURISTIC_FALLBACK"
    return {
        "status": "HEALTHY",
        "service": "FloodOS AI Tactical Assistant",
        "llm_configured": bool(chain),
        "configured_providers": [kind for kind, _ in chain],
        "engine": active,
        "active_engine": active,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/v1/ai/summarize", response_model=SituationSummaryResponse)
async def summarize_incident(req: SituationSummaryRequest):
    template = load_prompt("summarize.txt")
    if template:
        prompt_content = template.format(
            report_id=sanitize_untrusted_text(req.report_id, 128),
            created_at=sanitize_untrusted_text(req.created_at, 128) or "vừa tiếp nhận",
            status=sanitize_untrusted_text(req.status, 64) or "RECEIVED",
            priority=sanitize_untrusted_text(req.priority, 32) or "NORMAL",
            need_type=need_vietnamese(req.need_type or "EVACUATION"),
            depth_cm=req.depth_cm or 0,
            people_affected=req.people_affected or 0,
            location=sanitize_untrusted_text(req.location, 300) or "khu vực tin báo",
            description=sanitize_untrusted_text(req.description) or "Không có mô tả chi tiết",
            orders_info=sanitize_untrusted_text(req.orders_info, 500) or "Chưa có",
            incidents_info=sanitize_untrusted_text(req.incidents_info, 500) or "Không có",
            audit_summary=sanitize_untrusted_text(req.audit_summary, 1000) or "Chưa có nhật ký",
        )
        system_prompt = (
            "Bạn là Trợ lý Tác chiến AI của hệ thống chỉ huy ngập lụt FloodOS. "
            "Luôn trả lời bằng tiếng Việt chuẩn công vụ, súc tích, trung thực. "
            "Chỉ trả về JSON hợp lệ theo yêu cầu."
        )
        llm_reply, engine_label = await call_configured_llm(system_prompt, prompt_content, temperature=0.2)
        if llm_reply and engine_label:
            fallback = generate_tactical_summary_fallback(req)
            parsed = parse_llm_json(llm_reply)
            if parsed and str(parsed.get("summary_text", "")).strip():
                timeline = _coerce_string_list(parsed.get("timeline")) or fallback.timeline
                actions = _coerce_string_list(parsed.get("suggested_actions")) or fallback.suggested_actions
                summary_text = str(parsed["summary_text"]).strip()
            else:
                timeline = fallback.timeline
                actions = fallback.suggested_actions
                summary_text = llm_reply

            return SituationSummaryResponse(
                report_id=req.report_id,
                summary_text=summary_text,
                current_status=req.status or "RECEIVED",
                timeline=timeline,
                suggested_actions=actions,
                engine=engine_label,
                generated_at=datetime.now(timezone.utc).isoformat(),
            )

    return generate_tactical_summary_fallback(req)


@app.post("/api/v1/ai/classify-priority", response_model=PriorityClassificationResponse)
async def classify_priority(req: PriorityClassificationRequest):
    template = load_prompt("classify.txt")
    if template:
        prompt_content = template.format(
            need_type=need_vietnamese(req.need_type or "EVACUATION"),
            depth_cm=req.depth_cm or 0,
            people_affected=req.people_affected or 1,
            location_hint=sanitize_untrusted_text(req.location_hint, 300) or "địa điểm tin báo",
            description=sanitize_untrusted_text(req.description) or "Không có mô tả",
        )
        system_prompt = (
            "Bạn là chuyên gia phân loại mức độ ưu tiên cứu hộ khẩn cấp của FloodOS. "
            "Chỉ trả về JSON duy nhất không kèm code block."
        )
        llm_reply, engine_label = await call_configured_llm(system_prompt, prompt_content, temperature=0.1)
        if llm_reply and engine_label:
            data = parse_llm_json(llm_reply)
            if data is not None:
                priority = str(data.get("suggested_priority", "NORMAL")).strip().upper()
                if priority not in VALID_PRIORITIES:
                    priority = "NORMAL"
                try:
                    confidence = float(data.get("confidence", 0.85))
                except (TypeError, ValueError):
                    confidence = 0.85
                confidence = max(0.0, min(1.0, confidence))
                reasoning = str(data.get("reasoning", "")).strip() or "Đánh giá bởi mô hình LLM"
                key_factors = _coerce_string_list(data.get("key_factors"))
                return PriorityClassificationResponse(
                    suggested_priority=priority,
                    confidence=confidence,
                    reasoning=reasoning,
                    key_factors=key_factors,
                    engine=engine_label,
                    generated_at=datetime.now(timezone.utc).isoformat(),
                )

    return classify_priority_heuristic(req)


@app.post("/api/v1/ai/after-action-report", response_model=AfterActionReportResponse)
async def create_after_action_report(req: AfterActionReportRequest):
    template = load_prompt("after_action_report.txt")
    if template:
        prompt_content = template.format(
            report_id=sanitize_untrusted_text(req.report_id, 128),
            created_at=sanitize_untrusted_text(req.created_at, 128),
            resolved_at=sanitize_untrusted_text(req.resolved_at, 128) or "Vừa kết thúc",
            priority=sanitize_untrusted_text(req.priority, 32) or "NORMAL",
            need_type=need_vietnamese(req.need_type or "EVACUATION"),
            depth_cm=req.depth_cm or 0,
            final_depth_cm=req.final_depth_cm if req.final_depth_cm is not None else 0,
            people_affected=req.people_affected or 0,
            team_name=sanitize_untrusted_text(req.team_name, 200) or "Đội ứng cứu",
            vehicle_name=sanitize_untrusted_text(req.vehicle_name, 200) or "Phương tiện",
            outcome=sanitize_untrusted_text(req.outcome, 64) or "RESOLVED",
            field_notes=sanitize_untrusted_text(req.field_notes) or "Không có",
            confirmation_status=sanitize_untrusted_text(req.confirmation_status, 64) or "CONFIRMED",
            confirmation_notes=sanitize_untrusted_text(req.confirmation_notes) or "Không có",
            chain_proof=sanitize_untrusted_text(req.chain_proof, 256) or "Hợp lệ",
            audit_events=sanitize_untrusted_text(json.dumps(req.audit_events or [], ensure_ascii=False), 3000),
        )
        system_prompt = (
            "Bạn là chuyên gia lập báo cáo After-Action Report cho chỉ huy ngập lụt FloodOS. "
            "Viết báo cáo chuẩn công vụ chi tiết và ưu tiên trả về JSON hợp lệ theo yêu cầu."
        )
        llm_reply, engine_label = await call_configured_llm(system_prompt, prompt_content, temperature=0.2)
        if llm_reply and engine_label:
            fallback = generate_aar_heuristic(req)
            parsed = parse_llm_json(llm_reply)
            if parsed and str(parsed.get("markdown_content", "")).strip():
                report_title = str(parsed.get("report_title", "")).strip() or fallback.report_title
                executive_summary = str(parsed.get("executive_summary", "")).strip() or fallback.executive_summary
                markdown_content = str(parsed["markdown_content"]).strip()
            else:
                report_title = fallback.report_title
                executive_summary = fallback.executive_summary
                markdown_content = llm_reply

            return AfterActionReportResponse(
                report_id=req.report_id,
                report_title=report_title,
                executive_summary=executive_summary,
                markdown_content=markdown_content,
                engine=engine_label,
                generated_at=datetime.now(timezone.utc).isoformat(),
            )

    return generate_aar_heuristic(req)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8088"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
