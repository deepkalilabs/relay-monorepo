import { describe, expect, it } from "vitest";
import {
  createRepositories,
  createWorkflowRepositoryResolver,
} from "@/server/infrastructure/storage/repository-factory";
import { FileProfileRepository } from "@/server/profiles/filesystem-repository";
import { FileWorkflowRepository } from "@/server/workflows/filesystem-repository";
import { RemoteWorkflowRepository } from "@/server/workflows/http-repository";

describe("createWorkflowRepositoryResolver", () => {
  it("keeps development usable with local storage when Relay is not configured", async () => {
    const resolver = createWorkflowRepositoryResolver({}, { development: true });

    await expect(resolver.listWorkspaces()).resolves.toEqual({
      workspaces: [{ key: "local", name: "Local", source: "local" }],
      defaultKey: "local",
      namespaceWarning: "Relay namespaces are not configured.",
    });
    await expect(resolver.resolve("local")).resolves.toBeInstanceOf(FileWorkflowRepository);
  });

  it("requires Relay configuration in production", () => {
    expect(() => createWorkflowRepositoryResolver({}, { development: false }))
      .toThrow("RELAY_API_BASE_URL");
  });

  it("rejects invalid or incomplete Relay configuration safely", () => {
    expect(() => createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: "not a URL",
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    }, { development: true })).toThrow("RELAY_API_BASE_URL");
    expect(() => createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: "https://storage.example.test",
    }, { development: true })).toThrow("RELAY_API_USERNAME");
    expect(() => createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: "https://storage.example.test",
      RELAY_API_USERNAME: "relay",
    }, { development: true })).toThrow("RELAY_API_PASSWORD");
    expect(() => createWorkflowRepositoryResolver({
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    }, { development: true })).toThrow("RELAY_API_BASE_URL");
    expect(() => createWorkflowRepositoryResolver({
      RELAY_API_BASE_URL: "https://user:password@storage.example.test/api?tenant=private",
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    }, { development: true })).toThrow("RELAY_API_BASE_URL");
  });

  it("keeps profiles local when workflows use Relay", () => {
    const repositories = createRepositories({
      DATA_SOURCE: "remote",
      RELAY_API_BASE_URL: "https://relay.example.test",
      RELAY_API_USERNAME: "relay",
      RELAY_API_PASSWORD: "secret",
    });

    expect(repositories.profileRepository).toBeInstanceOf(FileProfileRepository);
    expect(repositories.workflowRepository).toBeInstanceOf(RemoteWorkflowRepository);
  });
});
