import type { Metadata } from "next";
import { AutomationsScreen } from "@/features/automations";

export const metadata: Metadata = {
  title: "Automations | Browser Memory Recorder",
  description: "Organize browser workflows into folders and review their run activity.",
};

export default function AutomationsPage() {
  return <AutomationsScreen />;
}
