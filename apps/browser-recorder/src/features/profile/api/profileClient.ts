"use client";

import {
  ProfileListResponseSchema,
  ProfileSchema,
  type Profile,
  type ProfileInput,
  type ProfileListResponse,
} from "@/shared/contracts/profile";

export class ProfileRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProfileRequestError";
  }
}

export interface ProfileClient {
  list(): Promise<ProfileListResponse>;
  get(id: string): Promise<Profile>;
  create(profile: ProfileInput): Promise<Profile>;
  save(id: string, profile: ProfileInput, expectedRevision: number): Promise<Profile>;
  delete(id: string, expectedRevision: number): Promise<void>;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : "The profile request failed.";
    throw new ProfileRequestError(message, response.status);
  }
  return body;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const profileClient: ProfileClient = {
  async list() {
    return ProfileListResponseSchema.parse(await readJson(await fetch("/api/profiles")));
  },
  async get(id) {
    return ProfileSchema.parse(await readJson(await fetch(`/api/profiles/${encodeURIComponent(id)}`)));
  },
  async create(profile) {
    return ProfileSchema.parse(await readJson(await fetch(
      "/api/profiles",
      jsonRequest("POST", { profile }),
    )));
  },
  async save(id, profile, expectedRevision) {
    return ProfileSchema.parse(await readJson(await fetch(
      `/api/profiles/${encodeURIComponent(id)}`,
      jsonRequest("PUT", { profile, expectedRevision }),
    )));
  },
  async delete(id, expectedRevision) {
    const response = await fetch(
      `/api/profiles/${encodeURIComponent(id)}`,
      jsonRequest("DELETE", { expectedRevision }),
    );
    if (!response.ok) await readJson(response);
  },
};
