import type { Metadata, Viewport } from "next";
import "./_styles/globals.css";
import "./(product)/workflows/[workflowId]/edit/_styles/workspace.css";
import "@/features/recorder/recorder.css";
import "@/features/replay/replay.css";
import "@/features/browser/browser.css";
import "@/features/workflow-editor/workflow.css";
import "@/features/workflow-library/workflow-thumbnail-assets.css";
import "@/shared/ui/modal/modal.css";

export const metadata: Metadata = {
  title: "Browser Memory Recorder",
  description: "Turn browser interactions into editable semantic workflows.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
