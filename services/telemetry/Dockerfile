# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

FROM python:3.12-slim

RUN useradd --create-home --uid 10001 telemetry
USER telemetry
ENV HOME=/home/telemetry PYTHONUNBUFFERED=1
WORKDIR /app

COPY --chown=telemetry requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt
ENV PATH="/home/telemetry/.local/bin:${PATH}"

COPY --chown=telemetry ingestor.py simulator.py ./

EXPOSE 8091
CMD ["python", "ingestor.py"]
