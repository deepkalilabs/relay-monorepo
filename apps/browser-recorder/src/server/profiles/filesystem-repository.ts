import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_PROFILE_FILE_BYTES,
  ProfileInputSchema,
  deriveProfileStatus,
  parseProfileJson,
  serializeProfile,
  type Profile,
  type ProfileInput,
} from "@/shared/contracts/profile";
import {
  ProfileConflictError,
  ProfileNotFoundError,
  ProfileValidationError,
  type ProfileListResult,
  type ProfileRepository,
} from "./repository";

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function defaultProfileDataDirectory(): string {
  return process.env.PROFILE_DATA_DIR || path.join(process.cwd(), ".data", "profiles");
}

export class FileProfileRepository implements ProfileRepository {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly rootDir = defaultProfileDataDirectory()) {}

  async list(): Promise<ProfileListResult> {
    await this.ensureRoot();
    const filenames = await readdir(this.rootDir);
    const profiles: Profile[] = [];
    let invalidFileCount = 0;

    await Promise.all(filenames.filter((filename) => filename.endsWith(".json")).map(async (filename) => {
      try {
        const id = filename.slice(0, -".json".length);
        if (!PROFILE_ID.test(id)) throw new ProfileValidationError("Profile filenames must use a UUID.");
        const profile = await this.read(id);
        if (profile.id !== id) throw new ProfileValidationError("The profile ID does not match its filename.");
        profiles.push(profile);
      } catch {
        invalidFileCount += 1;
      }
    }));

    profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      profiles: profiles.map(({ id, name, status, updatedAt }) => ({ id, name, status, updatedAt })),
      skippedRecordCount: invalidFileCount,
    };
  }

  async create(input: ProfileInput): Promise<Profile> {
    const id = randomUUID();
    return this.withLock(id, async () => {
      const now = new Date().toISOString();
      const normalized = this.parseInput(input);
      const profile: Profile = {
        schemaVersion: "1.1",
        id,
        ...normalized,
        status: deriveProfileStatus(normalized),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.write(profile);
      return profile;
    });
  }

  async get(id: string): Promise<Profile> {
    this.assertId(id);
    return this.read(id);
  }

  async save(id: string, input: ProfileInput, expectedRevision: number): Promise<Profile> {
    return this.withLock(id, async () => {
      const current = await this.read(id);
      this.assertRevision(current, expectedRevision);
      const normalized = this.parseInput(input);
      const profile: Profile = {
        ...current,
        ...normalized,
        status: deriveProfileStatus(normalized),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.write(profile);
      return profile;
    });
  }

  async delete(id: string, expectedRevision: number): Promise<void> {
    return this.withLock(id, async () => {
      const current = await this.read(id);
      this.assertRevision(current, expectedRevision);
      try {
        await unlink(this.filename(id));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          throw new ProfileNotFoundError();
        }
        throw error;
      }
    });
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  private assertId(id: string): void {
    if (!PROFILE_ID.test(id)) throw new ProfileValidationError("Profile IDs must be UUIDs.");
  }

  private assertRevision(profile: Profile, expectedRevision: number): void {
    if (profile.revision !== expectedRevision) throw new ProfileConflictError();
  }

  private parseInput(input: ProfileInput): ProfileInput {
    const parsed = ProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ProfileValidationError(parsed.error.issues[0]?.message ?? "The profile is invalid.");
    }
    return parsed.data;
  }

  private async read(id: string): Promise<Profile> {
    this.assertId(id);
    const filename = this.filename(id);
    try {
      const file = await stat(filename);
      if (file.size > MAX_PROFILE_FILE_BYTES) {
        throw new ProfileValidationError("Profile files must be 64 KiB or smaller.");
      }
      try {
        return parseProfileJson(await readFile(filename, "utf8"), file.size);
      } catch (error) {
        throw new ProfileValidationError(error instanceof Error ? error.message : "The profile is invalid.");
      }
    } catch (error) {
      if (error instanceof ProfileValidationError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new ProfileNotFoundError();
      }
      throw error;
    }
  }

  private async write(profile: Profile): Promise<void> {
    await this.ensureRoot();
    const temporary = path.join(this.rootDir, `.${profile.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serializeProfile(profile), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename(profile.id));
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private filename(id: string): string {
    return path.join(this.rootDir, `${id}.json`);
  }

  private async withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    this.assertId(id);
    const previous = this.locks.get(id) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const settled = result.then(() => undefined, () => undefined);
    this.locks.set(id, settled);
    try {
      return await result;
    } finally {
      if (this.locks.get(id) === settled) this.locks.delete(id);
    }
  }
}
