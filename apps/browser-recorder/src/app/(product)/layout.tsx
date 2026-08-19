import { WorkspaceProvider } from "@/shared/ui/workspace";

export default function ProductLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
