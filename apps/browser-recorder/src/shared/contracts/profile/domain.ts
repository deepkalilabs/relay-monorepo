export type ProfileStatus = "draft" | "ready";

export interface ProfileInput {
  name: string;
  identity: {
    fullName: string;
    email: string;
  };
  location: {
    countryRegion: string;
    postalCode: string;
  };
}

export interface Profile extends ProfileInput {
  schemaVersion: "1.1";
  id: string;
  status: ProfileStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSummary {
  id: string;
  name: string;
  status: ProfileStatus;
  updatedAt: string;
}

export interface ProfileListResponse {
  profiles: ProfileSummary[];
  invalidFileCount: number;
}
