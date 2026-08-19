import type { Metadata } from "next";
import { ProfileScreen } from "@/features/profile";

export const metadata: Metadata = {
  title: "Profiles | Browser Memory Recorder",
  description: "Review reusable identity, location, and browser parameters.",
};

interface ProfilePageProps {
  searchParams: Promise<{ selected?: string }>;
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const { selected } = await searchParams;
  return <ProfileScreen initialSelectedId={selected} />;
}
