"use client";

import { AlertTriangle, Radio } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  WORKSPACE_STORAGE_KEY,
  workspaceCatalogClient,
  type WorkspaceCatalog,
  type WorkspaceCatalogClient,
  type WorkspaceOption,
} from "@/shared/api/workspaceClient";
import { Modal } from "@/shared/ui/modal";
import { WorkspaceSelector } from "./WorkspaceSelector";
import styles from "./Workspace.module.css";

interface WorkspaceContextValue {
  active: WorkspaceOption;
  openSwitcher: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

interface WorkspaceProviderProps {
  children: ReactNode;
  client?: WorkspaceCatalogClient;
  navigate?: (url: string) => void;
}

export function WorkspaceProvider({
  children,
  client = workspaceCatalogClient,
  navigate = (url) => window.location.assign(url),
}: WorkspaceProviderProps) {
  const [catalog, setCatalog] = useState<WorkspaceCatalog | null>(null);
  const [active, setActive] = useState<WorkspaceOption | null>(null);
  const [pendingKey, setPendingKey] = useState("");
  const [status, setStatus] = useState<"loading" | "error" | "selecting" | "ready">("loading");
  const [switching, setSwitching] = useState(false);

  const applyCatalog = useCallback((loaded: WorkspaceCatalog) => {
    setCatalog(loaded);
    const rememberedKey = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const remembered = loaded.workspaces.find(({ key }) => key === rememberedKey);
    if (remembered) {
      setActive(remembered);
      setPendingKey(remembered.key);
      setStatus("ready");
      return;
    }
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    setActive(null);
    setPendingKey(loaded.defaultKey);
    setStatus("selecting");
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      applyCatalog(await client.list());
    } catch {
      setStatus("error");
    }
  }, [applyCatalog, client]);

  useEffect(() => {
    let activeRequest = true;
    client.list().then(
      (loaded) => { if (activeRequest) applyCatalog(loaded); },
      () => { if (activeRequest) setStatus("error"); },
    );
    return () => { activeRequest = false; };
  }, [applyCatalog, client]);

  const confirmInitial = () => {
    const selected = catalog?.workspaces.find(({ key }) => key === pendingKey);
    if (!selected) return;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, selected.key);
    setActive(selected);
    setStatus("ready");
  };

  const confirmSwitch = () => {
    const selected = catalog?.workspaces.find(({ key }) => key === pendingKey);
    if (!selected || !active) return;
    if (selected.key === active.key) {
      setSwitching(false);
      return;
    }
    localStorage.setItem(WORKSPACE_STORAGE_KEY, selected.key);
    navigate("/library");
  };

  if (status === "loading") {
    return <main className={styles.state} aria-busy="true"><p role="status">Loading workspaces…</p></main>;
  }
  if (status === "error") {
    return (
      <main className={styles.state}>
        <AlertTriangle size={24} aria-hidden="true" />
        <h1>Workspaces could not be loaded</h1>
        <p role="alert">Check the storage service, then try again.</p>
        <button className="button button-primary" type="button" onClick={() => void load()}>Retry</button>
      </main>
    );
  }
  if (status === "selecting" && catalog) {
    return (
      <main className={styles.gate}>
        <section className={styles.card} aria-labelledby="workspace-title">
          <span className={styles.brandMark}><Radio size={19} aria-hidden="true" /></span>
          <h1 id="workspace-title">Choose a workspace</h1>
          <p>Select where workflow recordings should be loaded and saved.</p>
          <WorkspaceSelector
            actionLabel="Continue"
            options={catalog.workspaces}
            selectedKey={pendingKey}
            warning={catalog.namespaceWarning}
            onChange={setPendingKey}
            onSubmit={confirmInitial}
          />
        </section>
      </main>
    );
  }
  if (!active || !catalog) return null;
  return (
    <WorkspaceContext.Provider value={{
      active,
      openSwitcher: () => { setPendingKey(active.key); setSwitching(true); },
    }}>
      {children}
      <Modal
        open={switching}
        title="Change workspace"
        description="Switching reloads workflow data. Unsaved page changes will be lost."
        onClose={() => setSwitching(false)}
      >
        <WorkspaceSelector
          actionLabel="Switch workspace"
          options={catalog.workspaces}
          selectedKey={pendingKey}
          warning={catalog.namespaceWarning}
          onChange={setPendingKey}
          onSubmit={confirmSwitch}
        />
      </Modal>
    </WorkspaceContext.Provider>
  );
}

export type { WorkspaceCatalogClient } from "@/shared/api/workspaceClient";
