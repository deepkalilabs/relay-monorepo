FROM node:24-slim AS manifests

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/workflow-contract/package.json packages/workflow-contract/
COPY packages/replay-core/package.json packages/replay-core/
COPY packages/automation-core/package.json packages/automation-core/
COPY packages/automation-worker-browserbase/package.json packages/automation-worker-browserbase/
COPY apps/browser-recorder/package.json apps/browser-recorder/
COPY apps/automation-service-browserbase/package.json apps/automation-service-browserbase/

FROM manifests AS build

RUN npm ci \
  --workspace @relay/workflow-contract \
  --workspace @relay/replay-core \
  --workspace @relay/automation-core \
  --workspace @relay/automation-worker-browserbase \
  --workspace @relay/automation-service-browserbase

COPY packages/workflow-contract/ packages/workflow-contract/
COPY packages/replay-core/ packages/replay-core/
COPY packages/automation-core/ packages/automation-core/
COPY packages/automation-worker-browserbase/ packages/automation-worker-browserbase/
COPY apps/automation-service-browserbase/ apps/automation-service-browserbase/

RUN npm run build --workspace @relay/workflow-contract \
 && npm run build --workspace @relay/replay-core \
 && npm run build --workspace @relay/automation-core \
 && npm run build --workspace @relay/automation-worker-browserbase \
 && npm run build --workspace @relay/automation-service-browserbase

FROM manifests AS production-dependencies

ENV NODE_ENV=production

RUN npm ci --omit=dev \
  --workspace @relay/workflow-contract \
  --workspace @relay/replay-core \
  --workspace @relay/automation-core \
  --workspace @relay/automation-worker-browserbase \
  --workspace @relay/automation-service-browserbase

FROM node:24-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV AUTOMATION_HOST=0.0.0.0
ENV AUTOMATION_SCREENSHOTS=false

COPY --from=production-dependencies /app/ /app/

COPY --from=build /app/packages/workflow-contract/dist/ packages/workflow-contract/dist/
COPY --from=build /app/packages/replay-core/dist/ packages/replay-core/dist/
COPY --from=build /app/packages/automation-core/dist/ packages/automation-core/dist/
COPY --from=build /app/packages/automation-worker-browserbase/dist/ packages/automation-worker-browserbase/dist/
COPY --from=build /app/apps/automation-service-browserbase/dist/ apps/automation-service-browserbase/dist/

EXPOSE 8080

CMD ["node", "apps/automation-service-browserbase/dist/main.js"]
