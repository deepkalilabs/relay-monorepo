export const profileFieldIds = [
  "identity.fullName",
  "identity.email",
  "location.countryRegion",
  "location.postalCode",
] as const;

export type ProfileFieldId = (typeof profileFieldIds)[number];
