"use client";

import { Database, Folder, Radio, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { useOptionalWorkspace } from "@/shared/ui/workspace";
import styles from "./AppSidebar.module.css";

export type AppDestination = "library" | "automations" | "profiles";

interface AppSidebarProps {
  activeDestination: AppDestination;
}

const destinations = [
  { id: "library" as const, href: "/library", label: "Library", Icon: Folder },
  { id: "automations" as const, href: "/automations", label: "Automations", Icon: Zap },
  { id: "profiles" as const, href: "/profile", label: "Profiles", Icon: UserRound },
];

export function AppSidebar({ activeDestination }: AppSidebarProps) {
  const workspace = useOptionalWorkspace();
  return (
    <aside className={styles.sidebar} aria-label="Primary navigation">
      <Link
        className={styles.brand}
        href="/library"
        aria-label="Memory Recorder home"
        title="Memory Recorder home"
      >
        <span className={styles.brandMark}>
          <Radio size={17} aria-hidden="true" />
        </span>
        <span>Memory Recorder</span>
      </Link>
      <nav className={styles.navigation}>
        {destinations.map(({ id, href, label, Icon }) => {
          const active = activeDestination === id;
          return (
            <Link
              className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
              href={href}
              title={label}
              aria-current={active ? "page" : undefined}
              key={id}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <span className={styles.spacer} />
      {workspace ? (
        <button
          className={styles.workspace}
          type="button"
          title={`Workspace: ${workspace.active.name}`}
          aria-label={`Change workspace. Current workspace: ${workspace.active.name}`}
          onClick={workspace.openSwitcher}
        >
          <Database size={16} aria-hidden="true" />
          <span>
            <small>Workspace</small>
            <strong>{workspace.active.name}</strong>
          </span>
        </button>
      ) : null}
      <span className={styles.avatar}>
        <span className="sr-only">Signed in as </span>
        N
      </span>
    </aside>
  );
}
