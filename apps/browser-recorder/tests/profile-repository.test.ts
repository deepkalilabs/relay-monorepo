import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProfileConflictError,
  ProfileNotFoundError,
} from "@/server/profiles/repository";
import { FileProfileRepository } from "@/server/profiles/filesystem-repository";
import type { ProfileInput } from "@/shared/contracts/profile";

const directories: string[] = [];

const readyInput: ProfileInput = {
  name: "Work — US",
  identity: { fullName: "Alex Johnson", email: "alex@example.com" },
  location: { countryRegion: "United States", postalCode: "94103" },
};

async function repository() {
  const rootDir = await mkdtemp(join(tmpdir(), "memory-recorder-profiles-"));
  directories.push(rootDir);
  return { rootDir, repository: new FileProfileRepository(rootDir) };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileProfileRepository", () => {
  it("creates a normalized profile and stores a private canonical JSON file", async () => {
    const { rootDir, repository: profiles } = await repository();

    const created = await profiles.create({
      ...readyInput,
      name: "  Work — US  ",
    });
    const filename = join(rootDir, `${created.id}.json`);

    expect(created).toMatchObject({
      schemaVersion: "1.1",
      name: "Work — US",
      status: "ready",
      revision: 1,
    });
    expect(await profiles.get(created.id)).toEqual(created);
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(created);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
  });

  it("lists profiles newest first and isolates invalid canonical files", async () => {
    const { rootDir, repository: profiles } = await repository();
    const first = await profiles.create({ ...readyInput, name: "First" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await profiles.create({ ...readyInput, name: "Second" });
    await writeFile(join(rootDir, `${crypto.randomUUID()}.json`), "{", "utf8");
    await writeFile(join(rootDir, "notes.txt"), "ignore me", "utf8");

    const listed = await profiles.list();

    expect(listed.profiles).toEqual([
      { id: second.id, name: second.name, status: second.status, updatedAt: second.updatedAt },
      { id: first.id, name: first.name, status: first.status, updatedAt: first.updatedAt },
    ]);
    expect(listed.skippedRecordCount).toBe(1);
  });

  it("saves drafts and rejects stale or concurrent writes", async () => {
    const { repository: profiles } = await repository();
    const created = await profiles.create(readyInput);
    const draft = {
      ...readyInput,
      identity: { ...readyInput.identity, email: "invalid@" },
    };

    const results = await Promise.allSettled([
      profiles.save(created.id, { ...draft, name: "First edit" }, 1),
      profiles.save(created.id, { ...draft, name: "Second edit" }, 1),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const saved = results.find((result) => result.status === "fulfilled");
    expect(saved).toMatchObject({
      value: { revision: 2, status: "draft" },
    });
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.any(ProfileConflictError),
    });
  });

  it("revision-protects permanent deletion", async () => {
    const { repository: profiles } = await repository();
    const created = await profiles.create(readyInput);
    const saved = await profiles.save(created.id, { ...readyInput, name: "Updated" }, 1);

    await expect(profiles.delete(created.id, 1)).rejects.toBeInstanceOf(ProfileConflictError);
    await profiles.delete(created.id, saved.revision);
    await expect(profiles.get(created.id)).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("rejects invalid IDs and filename/content mismatches", async () => {
    const { rootDir, repository: profiles } = await repository();
    await expect(profiles.get("not-an-id")).rejects.toThrow(/UUID/i);
    const created = await profiles.create(readyInput);
    const mismatchedId = crypto.randomUUID();
    await writeFile(
      join(rootDir, `${mismatchedId}.json`),
      JSON.stringify({ ...created, id: crypto.randomUUID() }),
      "utf8",
    );

    const listed = await profiles.list();
    expect(listed.profiles).toEqual([{
      id: created.id,
      name: created.name,
      status: created.status,
      updatedAt: created.updatedAt,
    }]);
    expect(listed.skippedRecordCount).toBe(1);
  });
});
