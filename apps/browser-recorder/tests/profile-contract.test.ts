import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_FILE_BYTES,
  ProfileInputSchema,
  deriveProfileStatus,
  parseProfileJson,
  serializeProfile,
  type Profile,
} from "@/shared/contracts/profile";

function completeInput() {
  return {
    name: "  Work — US  ",
    identity: {
      fullName: "  Alex Johnson  ",
      email: "  alex@example.com  ",
    },
    location: {
      countryRegion: "  United States  ",
      postalCode: "  94103  ",
    },
  };
}

describe("profile contract", () => {
  it("normalizes surrounding whitespace and derives ready status", () => {
    const input = ProfileInputSchema.parse(completeInput());

    expect(input).toEqual({
      name: "Work — US",
      identity: {
        fullName: "Alex Johnson",
        email: "alex@example.com",
      },
      location: {
        countryRegion: "United States",
        postalCode: "94103",
      },
    });
    expect(deriveProfileStatus(input)).toBe("ready");
  });

  it("allows incomplete and invalid-email drafts while enforcing size bounds", () => {
    const draft = ProfileInputSchema.parse({
      ...completeInput(),
      identity: { fullName: "", email: "alex@" },
    });

    expect(deriveProfileStatus(draft)).toBe("draft");
    expect(() => ProfileInputSchema.parse({ ...completeInput(), name: "x".repeat(101) })).toThrow();
    expect(() => ProfileInputSchema.parse({
      ...completeInput(),
      location: { countryRegion: "United States", postalCode: "x".repeat(33) },
    })).toThrow();
  });

  it("round-trips a canonical profile and rejects malformed or oversized JSON", () => {
    const now = "2026-07-28T12:00:00.000Z";
    const profile: Profile = {
      schemaVersion: "1.1",
      id: "b2f93d58-0ff2-4dcf-9cf4-07fe48bf95d5",
      ...ProfileInputSchema.parse(completeInput()),
      status: "ready",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };

    expect(parseProfileJson(serializeProfile(profile))).toEqual(profile);
    expect(() => parseProfileJson("{")).toThrow(/valid JSON/i);
    expect(() => parseProfileJson("{}", MAX_PROFILE_FILE_BYTES + 1)).toThrow(/64 KiB/i);
    expect(() => parseProfileJson(JSON.stringify({ ...profile, status: "draft" }))).toThrow(/status/i);
  });

  it("normalizes legacy 1.0 browser fields into the reduced 1.1 profile", () => {
    const now = "2026-07-28T12:00:00.000Z";
    const legacy = {
      schemaVersion: "1.0",
      id: "b2f93d58-0ff2-4dcf-9cf4-07fe48bf95d5",
      ...ProfileInputSchema.parse(completeInput()),
      browser: {
        name: "Google Chrome",
        operatingSystem: "Windows 11",
      },
      status: "draft",
      revision: 3,
      createdAt: now,
      updatedAt: now,
    };

    const parsed = parseProfileJson(JSON.stringify(legacy));

    expect(parsed).toEqual({
      schemaVersion: "1.1",
      id: legacy.id,
      name: "Work — US",
      identity: {
        fullName: "Alex Johnson",
        email: "alex@example.com",
      },
      location: {
        countryRegion: "United States",
        postalCode: "94103",
      },
      status: "ready",
      revision: 3,
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed).not.toHaveProperty("browser");
  });
});
