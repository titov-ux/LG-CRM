# stt-service: VAD + faster-whisper (или fake без torch).
#
# Build args:
#   STT_FULL=1  — ставить faster-whisper (~тяжёлый образ с torch)
# По умолчанию лёгкий образ под STT_FAKE=1.
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
    STT_FAKE=1

EXPOSE 8765

CMD ["python", "server.py"]
