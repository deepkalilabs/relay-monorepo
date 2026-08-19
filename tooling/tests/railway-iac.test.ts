import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { createRailwayContext, project } from "railway/iac";

import railwayDefinition from "../../.railway/railway";

async function evaluate(environment: string) {
  return railwayDefinition(
    createRailwayContext({ environment }),
    project,
  );
}

describe("Railway development infrastructure", () => {
  it("refuses to evaluate outside the development environment", async () => {
    await expect(evaluate("production")).rejects.toThrow(
      "Railway IaC is restricted to the development environment.",
    );
  });

  it("defines the development stack without application volumes", async () => {
    const definition = await evaluate("development");

    expect(definition.name).toBe("shimmering-hope");
    expect(definition.resources.map(({ address }) => address)).toEqual([
      "database.Postgres-development",
      "bucket.relay-workflows-development",
      "service.relay-backend",
      "service.relay-automation",
      "service.relay_frontend",
    ]);
    expect(definition.resources).not.toContainEqual(
      expect.objectContaining({ type: "volume" }),
    );
  });

  it("deploys all services from the protected development branch", async () => {
    const definition = await evaluate("development");
    const services = definition.resources.filter(
      (resource) => resource.type === "service",
    );

    expect(services).toHaveLength(3);
    for (const service of services) {
      expect(service.source).toMatchObject({
        type: "github",
        repo: "deepkalilabs/relay-monorepo",
        branch: "development",
      });
      expect(service.deploy?.multiRegionConfig).toEqual({
        "us-west2": { numReplicas: 1 },
      });
    }
  });

  it("keeps automation private and wires service dependencies", async () => {
    const definition = await evaluate("development");
    const resources = new Map(
      definition.resources.map((resource) => [resource.address, resource]),
    );
    const api = resources.get("service.relay-backend");
    const automation = resources.get("service.relay-automation");
    const frontend = resources.get("service.relay_frontend");
    const bucket = resources.get("bucket.relay-workflows-development");

    expect(bucket).toMatchObject({ config: { region: "sjc" } });
    expect(api).toMatchObject({
      variables: {
        DATABASE_URL: { type: "reference", resource: "database.Postgres-development", output: "DATABASE_URL" },
        BUCKET: { type: "reference", resource: "bucket.relay-workflows-development", output: "BUCKET" },
        AUTOMATION_SERVICE_URL: {
          type: "literal",
          value: "http://${{relay-automation.RAILWAY_PRIVATE_DOMAIN}}:${{relay-automation.PORT}}",
        },
      },
    });
    expect(automation).toMatchObject({
      deploy: { healthcheckPath: "/health/ready" },
      variables: {
        AUTOMATION_HOST: { type: "literal", value: "0.0.0.0" },
        AUTOMATION_TRUST_PRIVATE_NETWORK: { type: "literal", value: "1" },
      },
    });
    expect(automation).not.toHaveProperty("networking.customDomains");
    expect(frontend).toMatchObject({
      networking: { privateNetworkEndpoint: "relayfrontend" },
      variables: {
        RELAY_API_BASE_URL: {
          type: "literal",
          value: "http://${{relay-backend.RAILWAY_PRIVATE_DOMAIN}}:${{relay-backend.PORT}}",
        },
      },
    });
  });

  it("runs API migrations in Railway pre-deploy instead of the container entrypoint", async () => {
    const [dockerfile, startScript] = await Promise.all([
      readFile("apps/relay-api/Dockerfile", "utf8"),
      readFile("apps/relay-api/scripts/start-api.sh", "utf8"),
    ]);

    expect(dockerfile).toContain('CMD ["scripts/start-api.sh"]');
    expect(dockerfile).not.toContain("ENTRYPOINT");
    expect(startScript).not.toContain("alembic upgrade head");
  });
});
