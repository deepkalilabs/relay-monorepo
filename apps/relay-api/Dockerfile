FROM python:3.12-slim AS base

RUN pip install --no-cache-dir uv

WORKDIR /repo/apps/relay-api

COPY apps/relay-api/pyproject.toml apps/relay-api/uv.lock apps/relay-api/README.md apps/relay-api/openapi.yaml apps/relay-api/hatch_build.py ./
COPY apps/automation-service-browserbase/openapi.yaml ../automation-service-browserbase/openapi.yaml
COPY apps/relay-api/src/ src/
RUN uv sync --frozen --no-dev

COPY apps/relay-api/alembic.ini ./
COPY apps/relay-api/migrations/ migrations/
COPY apps/relay-api/scripts/start-api.sh scripts/start-api.sh
RUN chmod +x scripts/start-api.sh

ENV PATH="/repo/apps/relay-api/.venv/bin:$PATH"

EXPOSE 8000

CMD ["scripts/start-api.sh"]
