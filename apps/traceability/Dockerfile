# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors

FROM python:3.12-slim

RUN useradd --create-home --uid 10001 trace
USER trace
ENV HOME=/home/trace PYTHONUNBUFFERED=1
WORKDIR /app

COPY --chown=trace requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt \
    && python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"
ENV PATH="/home/trace/.local/bin:${PATH}"

COPY --chown=trace traceability.py .

EXPOSE 8095
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8095/health',timeout=3).status==200 else 1)"
CMD ["python", "traceability.py"]
