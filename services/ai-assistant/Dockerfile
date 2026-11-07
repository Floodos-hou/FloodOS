# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

FROM python:3.12-slim

RUN useradd --create-home --uid 10002 aiassistant
USER aiassistant
ENV HOME=/home/aiassistant PYTHONUNBUFFERED=1
WORKDIR /app

COPY --chown=aiassistant requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt
ENV PATH="/home/aiassistant/.local/bin:${PATH}"

COPY --chown=aiassistant prompts ./prompts
COPY --chown=aiassistant app.py .

EXPOSE 8088
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8088/health',timeout=3).status==200 else 1)"

CMD ["python", "app.py"]
