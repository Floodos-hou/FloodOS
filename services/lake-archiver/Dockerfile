# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

FROM python:3.12-slim

RUN useradd --create-home --uid 10001 archiver
USER archiver
ENV HOME=/home/archiver PYTHONUNBUFFERED=1
WORKDIR /app

COPY --chown=archiver requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt \
    && python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"
ENV PATH="/home/archiver/.local/bin:${PATH}"

COPY --chown=archiver archiver.py .

EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/health',timeout=3).status==200 else 1)"
CMD ["python", "archiver.py"]
