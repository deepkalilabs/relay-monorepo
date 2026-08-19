import type { Profile } from "./domain";
import { CompatibleProfileSchema, ProfileSchema } from "./schema";

export const MAX_PROFILE_FILE_BYTES = 65_536;

function issueMessage(path: PropertyKey[], message: string): string {
  const location = path.length ? path.map(String).join(".") : "profile";
  return `${location}: ${message}`;
}

export function parseProfileJson(
  text: string,
  sizeBytes = new TextEncoder().encode(text).byteLength,
): Profile {
  if (sizeBytes > MAX_PROFILE_FILE_BYTES) {
    throw new Error("Profile files must be 64 KiB or smaller.");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The profile file is not valid JSON.");
  }

  const parsed = CompatibleProfileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue ? issueMessage(issue.path, issue.message) : "The profile is invalid.");
  }
  return parsed.data;
}

export function serializeProfile(profile: Profile): string {
  return `${JSON.stringify(ProfileSchema.parse(profile), null, 2)}\n`;
}
