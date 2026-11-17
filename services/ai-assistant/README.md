# FloodOS AI Tactical Assistant Service

`services/ai-assistant` is a thin microservice providing tactical AI co-pilot capabilities for FloodOS Dispatchers, Field Commanders, and Public Auditors.

---

## 1. Capabilities

1. **AI Situation Summary for Dispatchers (`POST /api/v1/ai/summarize`)**:
   - Synthesizes real-time incident reports, hydrometric telemetry, team deployments, and vehicle incidents.
   - Generates an executive summary, chronologically sequenced timeline, and actionable next steps.

2. **AI Priority Classification (`POST /api/v1/ai/classify-priority`)**:
   - Analyzes raw citizen SOS reports (text description, water depth, stranded people, medical emergency markers).
   - Recommends an operational priority (`CRITICAL`, `URGENT`, `HIGH`, `NORMAL`, `LOW`) with confidence score and justification.
   - Adheres strictly to the **Human-in-the-Loop** principle: Dispatchers always make the final operational decision.

3. **AI After-Action Report Generation (`POST /api/v1/ai/after-action-report`)**:
   - When a report or incident reaches `RESOLVED` / `CLOSED` state, generates a structured official After-Action Report (AAR).
   - Verifies and references the immutable SHA-256 audit hash-chain.

---

## 2. Dual-Engine Architecture (Zero-Mock Drift)

- **Live LLM Engine**: Supports OpenAI-compatible Chat Completions (`OPENAI_API_KEY`) and Anthropic Messages API (`ANTHROPIC_API_KEY`). When `AI_PROVIDER=auto`, OpenAI is tried first (if configured), then Anthropic (if configured).
- **Tactical Heuristic Engine (Deterministic Fallback)**: Automatically activates when no API key is supplied, when the network is isolated, or when an upstream LLM call fails/returns invalid output.
- All responses declare their active processing engine (`OPENAI_...`, `ANTHROPIC_...`, or `TACTICAL_HEURISTIC_FALLBACK`) for 100% transparency.

---

## 3. Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8088` | HTTP listening port |
| `AI_PROVIDER` | `auto` | Provider selection (`auto`, `openai`, `anthropic`) |
| `OPENAI_API_KEY` | *(empty)* | OpenAI-compatible API secret key |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model name |
| `OPENAI_API_BASE` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `ANTHROPIC_API_KEY` | *(empty)* | Anthropic API secret key |
| `ANTHROPIC_MODEL` | `claude-3-5-haiku-latest` | Anthropic model name |
| `ANTHROPIC_API_BASE` | `https://api.anthropic.com` | Anthropic API base URL |
| `LLM_TIMEOUT_SECONDS` | `15.0` | Upstream LLM request timeout (seconds) |
| `CORS_ALLOW_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173` | Allowed CORS origins (comma-separated) |
| `LOG_LEVEL` | `INFO` | Python logger level |

---

## 4. Local Development & Testing

```bash
cd services/ai-assistant
pip install -r requirements.txt
python -m pytest tests/
python app.py
```
