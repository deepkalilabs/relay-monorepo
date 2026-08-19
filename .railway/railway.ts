import {
  bucket,
  defineRailway,
  github,
  postgres,
  project,
  ref,
  service,
} from "railway/iac";

const repository = "deepkalilabs/relay-monorepo";
const branch = "development";
const region = "us-west2";

export default defineRailway((context) => {
  if (!context.isEnvironment("development")) {
    throw new Error("Railway IaC is restricted to the development environment.");
  }

  const database = postgres("Postgres", { region });
  const workflowBucket = bucket("relay-workflows-development", { region: "sjc" });

  const api = service("relay-backend", {
    source: github(repository, { branch }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/relay-api/Dockerfile",
      watchPatterns: [
        "/apps/relay-api/**",
        "/apps/automation-service-browserbase/openapi.yaml",
      ],
    },
    start: "scripts/start-api.sh",
    preDeploy: "alembic upgrade head",
    healthcheck: "/docs",
    healthcheckTimeout: 300,
    replicas: { [region]: 1 },
    env: {
      PORT: "8000",
      DATABASE_URL: database.env.DATABASE_URL,
      BASIC_AUTH_USERNAME: context.shared.RELAY_API_USERNAME,
      BASIC_AUTH_PASSWORD: context.shared.RELAY_API_PASSWORD,
      BUCKET: ref(workflowBucket, "BUCKET"),
      ENDPOINT: ref(workflowBucket, "ENDPOINT"),
      ACCESS_KEY_ID: ref(workflowBucket, "ACCESS_KEY_ID"),
      SECRET_ACCESS_KEY: ref(workflowBucket, "SECRET_ACCESS_KEY"),
      REGION: ref(workflowBucket, "REGION"),
      AUTOMATION_SERVICE_URL:
        "http://${{relay-automation.RAILWAY_PRIVATE_DOMAIN}}:${{relay-automation.PORT}}",
    },
  });

  const automation = service("relay-automation", {
    source: github(repository, { branch }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/automation-service-browserbase/Dockerfile",
      watchPatterns: [
        "/package.json",
        "/package-lock.json",
        "/apps/automation-service-browserbase/**",
        "/packages/automation-core/**",
        "/packages/automation-worker-browserbase/**",
        "/packages/replay-core/**",
        "/packages/workflow-contract/**",
      ],
    },
    start: "node apps/automation-service-browserbase/dist/main.js",
    healthcheck: "/health/ready",
    healthcheckTimeout: 300,
    replicas: { [region]: 1 },
    env: {
      PORT: "8080",
      AUTOMATION_HOST: "0.0.0.0",
      AUTOMATION_SCREENSHOTS: "true",
      AUTOMATION_TRUST_PRIVATE_NETWORK: "1",
      BROWSERBASE_API_KEY: context.shared.BROWSERBASE_API_KEY,
      BROWSERBASE_REGION: "us-west-2",
    },
  });

  const frontend = service("relay_frontend", {
    source: github(repository, { branch }),
    build: {
      builder: "RAILPACK",
      buildCommand:
        "npm run build --workspace @relay/workflow-contract && npm run build --workspace @relay/replay-core && npm run build --workspace browser-memory-recorder",
      watchPatterns: [
        "/package.json",
        "/package-lock.json",
        "/apps/browser-recorder/**",
        "/packages/replay-core/**",
        "/packages/workflow-contract/**",
      ],
    },
    start: "npm run start --workspace browser-memory-recorder",
    healthcheck: "/",
    healthcheckTimeout: 300,
    replicas: { [region]: 1 },
    env: {
      PORT: "3000",
      BROWSERBASE_API_KEY: context.shared.BROWSERBASE_API_KEY,
      BROWSERBASE_REGION: "us-west-2",
      BROWSERBASE_SESSION_TIMEOUT_SECONDS: "1800",
      RELAY_API_BASE_URL:
        "http://${{relay-backend.RAILWAY_PRIVATE_DOMAIN}}:${{relay-backend.PORT}}",
      RELAY_API_USERNAME: context.shared.RELAY_API_USERNAME,
      RELAY_API_PASSWORD: context.shared.RELAY_API_PASSWORD,
    },
  });

  return project("shimmering-hope", {
    resources: [database, workflowBucket, api, automation, frontend],
  });
});
