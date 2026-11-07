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

- **Live LLM Engine**: Connected to OpenAI API (`gpt-4o-mini` or specified model) or OpenAI-compatible endpoint when `OPENAI_API_KEY` is provided.
- **Tactical Heuristic Engine (Deterministic Fallback)**: Automatically activates when no API key is supplied or when the network is isolated. Computes hydrological priority matrices, tactical timelines, and official post-action summaries deterministically.
- All responses declare their active processing engine (`engine: "OPENAI_..."` vs `engine: "TACTICAL_HEURISTIC_FALLBACK"`) for 100% transparency.

---

## 3. Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8088` | HTTP listening port |
| `OPENAI_API_KEY` | *(empty)* | OpenAI API secret key |
| `OPENAI_MODEL` | `gpt-4o-mini` | LLM model name |
| `OPENAI_API_BASE` | `https://api.openai.com/v1` | LLM API endpoint URL |

---

## 4. Local Development & Testing

```bash
cd services/ai-assistant
pip install -r requirements.txt
python -m pytest tests/
python app.py
```
