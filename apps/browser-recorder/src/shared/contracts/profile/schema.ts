import { z } from "zod";
import type {
  Profile,
  ProfileInput,
  ProfileListResponse,
  ProfileStatus,
  ProfileSummary,
} from "./domain";

const trimmedString = (maximum: number) => z.string().max(maximum).transform((value) => value.trim());

const profileInputShape = {
  name: trimmedString(100),
  identity: z.object({
    fullName: trimmedString(200),
    email: trimmedString(254),
  }),
  location: z.object({
    countryRegion: trimmedString(100),
    postalCode: trimmedString(32),
  }),
};

export const ProfileInputSchema = z.object(profileInputShape) satisfies z.ZodType<ProfileInput>;

const EmailSchema = z.email();

export function deriveProfileStatus(input: ProfileInput): ProfileStatus {
  const fields = [
    input.name,
    input.identity.fullName,
    input.identity.email,
    input.location.countryRegion,
    input.location.postalCode,
  ];
  return fields.every(Boolean) && EmailSchema.safeParse(input.identity.email).success
    ? "ready"
    : "draft";
}

export const ProfileSchema = z.object({
  schemaVersion: z.literal("1.1"),
  id: z.uuid(),
  ...profileInputShape,
  status: z.enum(["draft", "ready"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).superRefine((profile, context) => {
  if (profile.status !== deriveProfileStatus(profile)) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "Profile status must match its field readiness.",
    });
  }
}) satisfies z.ZodType<Profile>;

const LegacyProfileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.uuid(),
  ...profileInputShape,
  browser: z.object({
    name: trimmedString(100),
    operatingSystem: trimmedString(100),
  }),
  status: z.enum(["draft", "ready"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CompatibleProfileSchema = z.union([
  ProfileSchema,
  LegacyProfileSchema,
]).transform((profile): Profile => {
  if (profile.schemaVersion === "1.1") return profile;
  return {
    schemaVersion: "1.1",
    id: profile.id,
    name: profile.name,
    identity: profile.identity,
    location: profile.location,
    status: deriveProfileStatus(profile),
    revision: profile.revision,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
});

export const ProfileSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().max(100),
  status: z.enum(["draft", "ready"]),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<ProfileSummary>;

export const ProfileListResponseSchema = z.object({
  profiles: z.array(ProfileSummarySchema),
  invalidFileCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ProfileListResponse>;
