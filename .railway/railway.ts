import {
  bucket,
  defineRailway,
  github,
  group,
  postgres,
  project,
  ref,
  service,
} from "railway/iac";

export default defineRailway((ctx) => {
  if (!ctx.isEnvironment("development")) {
    throw new Error(
      `This Railway graph manages only development; received ${ctx.environment}.`,
    );
  }

  const database = postgres("Postgres");
  const workflowDocuments = bucket("workflow-documents", { region: "sjc" });

  const automation = service("relay-automation", {
    source: github("deepkalilabs/relay-monorepo", {
      branch: "main",
      rootDirectory: "backend",
    }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.automation",
      watchPatterns: [
        "/backend/Dockerfile.automation",
        "/backend/packages/automation-core/**",
        "/backend/packages/automation-service-browserbase/**",
        "/backend/packages/automation-worker-browserbase/**",
      ],
    },
    healthcheck: "/health/ready",
    replicas: 1,
    env: {
      PORT: "8080",
      AUTOMATION_HOST: "0.0.0.0",
      AUTOMATION_SCREENSHOTS: "true",
      AUTOMATION_TRUST_PRIVATE_NETWORK: "1",
      BROWSERBASE_API_KEY: ctx.shared.BROWSERBASE_API_KEY,
      BROWSERBASE_REGION: "us-west-2",
    },
  });

  const api = service("relay-backend", {
    source: github("deepkalilabs/relay-monorepo", {
      branch: "main",
      rootDirectory: "backend",
    }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.api",
      watchPatterns: [
        "/backend/Dockerfile.api",
        "/backend/alembic.ini",
        "/backend/migrations/**",
        "/backend/openapi.yaml",
        "/backend/packages/automation-service-browserbase/openapi.yaml",
        "/backend/pyproject.toml",
        "/backend/scripts/start-api.sh",
        "/backend/src/**",
        "/backend/uv.lock",
      ],
    },
    preDeploy: "alembic upgrade head",
    healthcheck: "/health/ready",
    replicas: 1,
    env: {
      PORT: "8000",
      DATABASE_URL: database.env.DATABASE_URL,
      BUCKET: ref(workflowDocuments, "BUCKET"),
      ENDPOINT: ref(workflowDocuments, "ENDPOINT"),
      ACCESS_KEY_ID: ref(workflowDocuments, "ACCESS_KEY_ID"),
      SECRET_ACCESS_KEY: ref(workflowDocuments, "SECRET_ACCESS_KEY"),
      REGION: ref(workflowDocuments, "REGION"),
      AUTOMATION_SERVICE_URL:
        "http://${{relay-automation.RAILWAY_PRIVATE_DOMAIN}}:8080",
      BASIC_AUTH_USERNAME: ctx.shared.RELAY_API_USERNAME,
      BASIC_AUTH_PASSWORD: ctx.shared.RELAY_API_PASSWORD,
    },
  });

  const frontend = service("relay_frontend", {
    source: github("deepkalilabs/relay-monorepo", {
      branch: "main",
      rootDirectory: "frontend",
    }),
    build: {
      builder: "RAILPACK",
      watchPatterns: ["/frontend/**"],
    },
    start: "npm start",
    healthcheck: "/",
    replicas: 1,
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    env: {
      PORT: "3000",
      RELAY_API_BASE_URL:
        "http://${{relay-backend.RAILWAY_PRIVATE_DOMAIN}}:8000",
      RELAY_API_USERNAME: ctx.shared.RELAY_API_USERNAME,
      RELAY_API_PASSWORD: ctx.shared.RELAY_API_PASSWORD,
    },
  });

  const applications = group("Applications", [frontend, api, automation]);
  const data = group("Data", [database, workflowDocuments]);

  return project("shimmering-hope", {
    resources: [applications, data],
  });
});
