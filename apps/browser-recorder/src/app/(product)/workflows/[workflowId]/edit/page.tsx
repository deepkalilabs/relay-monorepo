import { RecorderWorkspace } from "./_components/RecorderWorkspace";

interface WorkflowEditorPageProps {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<{ profile?: string | string[]; run?: string | string[] }>;
}

export default async function WorkflowEditorPage({ params, searchParams }: WorkflowEditorPageProps) {
  const { workflowId } = await params;
  const { profile, run } = await searchParams;
  const profileId = typeof profile === "string" ? profile : "";
  return <RecorderWorkspace workflowId={workflowId} profileId={profileId} autoRun={Boolean(profileId) || run === "1"} />;
}
