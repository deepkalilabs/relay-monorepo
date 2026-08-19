import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ProfileInputSchema,
  ProfileSchema,
  ProfileSummarySchema,
  type Profile,
  type ProfileInput,
} from "@/shared/contracts/profile";
import {
  RemoteHttpClient,
  type RemoteHttpClientOptions,
} from "@/server/infrastructure/storage/remote-http-client";
import {
  ProfileConflictError,
  ProfileNotFoundError,
  ProfileUnavailableError,
  ProfileValidationError,
  type ProfileListResult,
  type ProfileRepository,
} from "./repository";

const ProfileListResponseSchema = z.object({
  profiles: z.array(ProfileSummarySchema.strict()),
}).strict();

export class RemoteProfileRepository implements ProfileRepository {
  private readonly client: RemoteHttpClient;

  constructor(baseUrl: string, bearerToken: string, options: RemoteHttpClientOptions = {}) {
    this.client = new RemoteHttpClient(baseUrl, bearerToken, options);
  }

  async list(): Promise<ProfileListResult> {
    const response = await this.request("v1/profiles");
    const result = await this.parse(response, 200, ProfileListResponseSchema);
    return { profiles: result.profiles, skippedRecordCount: 0 };
  }

  async create(input: ProfileInput): Promise<Profile> {
    const profile = this.parseInput(input);
    return this.parse(await this.request("v1/profiles", {
      method: "POST",
      headers: this.mutationHeaders(),
      body: JSON.stringify({ profile }),
    }), 201, ProfileSchema);
  }

  async get(id: string): Promise<Profile> {
    return this.parse(await this.request(`v1/profiles/${encodeURIComponent(id)}`), 200, ProfileSchema);
  }

  async save(id: string, input: ProfileInput, expectedRevision: number): Promise<Profile> {
    const profile = this.parseInput(input);
    return this.parse(await this.request(`v1/profiles/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: this.mutationHeaders(),
      body: JSON.stringify({ profile, expectedRevision }),
    }), 200, ProfileSchema);
  }

  async delete(id: string, expectedRevision: number): Promise<void> {
    const response = await this.request(`v1/profiles/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.mutationHeaders(),
      body: JSON.stringify({ expectedRevision }),
    });
    if (!response.ok) this.throwResponseError(response.status);
    if (response.status !== 204) throw new ProfileUnavailableError();
  }

  private mutationHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    };
  }

  private async request(pathname: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.client.request(pathname, init);
    } catch {
      throw new ProfileUnavailableError();
    }
  }

  private parseInput(input: ProfileInput): ProfileInput {
    const parsed = ProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ProfileValidationError(parsed.error.issues[0]?.message ?? "The profile is invalid.");
    }
    return parsed.data;
  }

  private async parse<T>(response: Response, expectedStatus: number, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) this.throwResponseError(response.status);
    if (response.status !== expectedStatus) throw new ProfileUnavailableError();
    const body = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ProfileUnavailableError();
    return parsed.data;
  }

  private throwResponseError(status: number): never {
    if (status === 400 || status === 413) {
      throw new ProfileValidationError("The profile request is invalid.");
    }
    if (status === 404) throw new ProfileNotFoundError();
    if (status === 409) throw new ProfileConflictError();
    throw new ProfileUnavailableError();
  }
}
