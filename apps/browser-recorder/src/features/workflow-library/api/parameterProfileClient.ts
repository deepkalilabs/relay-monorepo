"use client";

import {
  ProfileListResponseSchema,
  ProfileSchema,
  type Profile,
  type ProfileListResponse,
} from "@/shared/contracts/profile";

export class ParameterProfileRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ParameterProfileRequestError";
  }
}

export interface ParameterProfileClient {
  list(): Promise<ProfileListResponse>;
  get(id: string): Promise<Profile>;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const message = typeof body === "object" && body !== null
      && "error" in body && typeof body.error === "string"
      ? body.error
      : "The profile request failed.";
    throw new ParameterProfileRequestError(message, response.status);
  }
  return body;
}

export const parameterProfileClient: ParameterProfileClient = {
  async list() {
    return ProfileListResponseSchema.parse(await readJson(await fetch("/api/profiles")));
  },
  async get(id) {
    return ProfileSchema.parse(await readJson(
      await fetch(`/api/profiles/${encodeURIComponent(id)}`),
    ));
  },
};
