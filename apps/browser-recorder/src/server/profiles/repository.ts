import type { Profile, ProfileInput, ProfileSummary } from "@/shared/contracts/profile";

export interface ProfileListResult {
  profiles: ProfileSummary[];
  skippedRecordCount: number;
}

export class ProfileNotFoundError extends Error {
  constructor() {
    super("The profile was not found.");
    this.name = "ProfileNotFoundError";
  }
}

export class ProfileConflictError extends Error {
  constructor() {
    super("The profile changed since it was loaded.");
    this.name = "ProfileConflictError";
  }
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export class ProfileUnavailableError extends Error {
  constructor() {
    super("Profile storage is temporarily unavailable.");
    this.name = "ProfileUnavailableError";
  }
}

export interface ProfileRepository {
  list(): Promise<ProfileListResult>;
  create(input: ProfileInput): Promise<Profile>;
  get(id: string): Promise<Profile>;
  save(id: string, input: ProfileInput, expectedRevision: number): Promise<Profile>;
  delete(id: string, expectedRevision: number): Promise<void>;
}
