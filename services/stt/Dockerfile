# stt-service: VAD + faster-whisper (или fake без torch).
#
# Build args:
#   STT_FULL=1  — ставить faster-whisper (~тяжёлый образ с torch)
# По умолчанию лёгкий образ под STT_FAKE=1.
#
# GPU (YC T4, отдельная VM — infra/terraform/stt.tf create_stt_vm=true):
#   base можно сменить на nvidia/cuda:12.2.0-cudnn8-runtime-ubuntu22.04,
#   STT_DEVICE=cuda STT_COMPUTE_TYPE=int8_float16 STT_MODEL=large-v3-turbo
#   STT_MAX_SESSIONS=8, docker --gpus all.
ARG STT_FULL=0

FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-full.txt ./
ARG STT_FULL
RUN if [ "$STT_FULL" = "1" ]; then \
      pip install --no-cache-dir -r requirements-full.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi

COPY server.py .

ENV STT_PORT=8765 \
    STT_MODEL=small \
    STT_DEVICE=cpu \
    STT_COMPUTE_TYPE=int8 \
    STT_CPU_THREADS=4 \
    STT_MAX_SESSIONS=8 \
    STT_FAKE=1

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/healthz', timeout=3)"

CMD ["python", "server.py"]
