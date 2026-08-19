import type { Metadata } from "next";
import { LibraryScreen } from "@/features/workflow-library";

export const metadata: Metadata = {
  title: "Library | Browser Memory Recorder",
  description: "Browse saved browser workflows and inspect their recorded steps.",
};

interface LibraryPageProps {
  searchParams: Promise<{ selected?: string }>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const { selected } = await searchParams;
  return <LibraryScreen initialSelectedId={selected} />;
}
