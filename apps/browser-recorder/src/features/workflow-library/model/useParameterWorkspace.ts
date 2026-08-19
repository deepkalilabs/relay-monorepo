"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Profile, ProfileSummary } from "@/shared/contracts/profile";
import type { ParameterBinding, Workflow } from "@/shared/contracts/workflow";
import { resolveWorkflowParameters } from "@/shared/contracts/workflow/parameters";
import {
  ParameterProfileRequestError,
  parameterProfileClient,
  type ParameterProfileClient,
} from "../api/parameterProfileClient";
import {
  WorkflowLibraryRequestError,
  workflowLibraryClient,
  type WorkflowLibraryClient,
} from "../api/workflowLibraryClient";
import { autoMapParameters } from "./autoMapParameters";
import {
  rebaseParameterBindings,
  type ParameterBindingConflict,
} from "./rebaseParameterBindings";

type SaveStatus = "ready" | "saving" | "error" | "conflict";

function bindingFingerprint(workflow: Workflow | null): string {
  if (!workflow) return "";
  return JSON.stringify(workflow.steps.flatMap((step) => (
    step.type === "fill" ? [[step.id, step.parameterBinding]] : []
  )));
}

export interface ParameterWorkspaceOptions {
  workflowId: string;
  workflowClient?: WorkflowLibraryClient;
  profileClient?: ParameterProfileClient;
  profiles: ProfileSummary[];
  profilesLoading: boolean;
  profilesError: string | null;
  navigate: (url: string) => void;
}

export function useParameterWorkspace({
  workflowId,
  workflowClient = workflowLibraryClient,
  profileClient = parameterProfileClient,
  profiles,
  profilesLoading,
  profilesError,
  navigate,
}: ParameterWorkspaceOptions) {
  const [base, setBase] = useState<Workflow | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ParameterBindingConflict[]>([]);

  useEffect(() => {
    let active = true;
    workflowClient.get(workflowId).then(
      (workflow) => {
        if (!active) return;
        setBase(workflow);
        setDraft(workflow);
        setWorkflowLoading(false);
        setStatus("ready");
      },
      (reason: unknown) => {
        if (!active) return;
        setWorkflowLoading(false);
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "The workflow could not be loaded.");
      },
    );
    return () => {
      active = false;
    };
  }, [workflowClient, workflowId]);

  useEffect(() => {
    if (!selectedProfileId) return;
    let active = true;
    profileClient.get(selectedProfileId).then(
      (loaded) => {
        if (!active) return;
        setProfile(loaded);
        setProfileLoading(false);
      },
      (reason: unknown) => {
        if (!active) return;
        setProfileLoading(false);
        if (reason instanceof ParameterProfileRequestError && reason.status === 404) {
          setSelectedProfileId("");
          setProfileError("That profile was deleted. Choose another profile.");
          return;
        }
        setProfileError(reason instanceof Error ? reason.message : "The profile could not be loaded.");
      },
    );
    return () => {
      active = false;
    };
  }, [profileClient, profileLoadAttempt, selectedProfileId]);

  const dirty = bindingFingerprint(base) !== bindingFingerprint(draft);
  const parameterResult = useMemo(
    () => draft ? resolveWorkflowParameters(draft, { profile }) : null,
    [draft, profile],
  );
  const updateBinding = useCallback((stepId: string, parameterBinding: ParameterBinding) => {
    setDraft((current) => current ? {
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId && step.type === "fill" ? { ...step, parameterBinding } : step
      )),
    } : current);
    setError(null);
  }, []);

  const selectProfile = useCallback((profileId: string) => {
    setSelectedProfileId(profileId);
    setProfile(null);
    setProfileError(null);
    setProfileLoading(Boolean(profileId));
  }, []);

  const retryProfile = useCallback(() => {
    if (!selectedProfileId) return;
    setProfile(null);
    setProfileError(null);
    setProfileLoading(true);
    setProfileLoadAttempt((attempt) => attempt + 1);
  }, [selectedProfileId]);

  const saveDraft = useCallback(async (): Promise<Workflow | null> => {
    if (!base || !draft) return null;
    if (!dirty) return base;
    setStatus("saving");
    setError(null);
    try {
      const saved = await workflowClient.save(workflowId, draft, base.revision);
      setBase(saved);
      setDraft(saved);
      setConflicts([]);
      setStatus("ready");
      return saved;
    } catch (reason) {
      if (!(reason instanceof WorkflowLibraryRequestError) || reason.status !== 409) {
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "The workflow could not be saved.");
        return null;
      }
    }

    try {
      const latest = await workflowClient.get(workflowId);
      const rebased = rebaseParameterBindings(base, draft, latest);
      setBase(latest);
      setDraft(rebased.workflow);
      if (rebased.conflicts.length) {
        setConflicts(rebased.conflicts);
        setStatus("conflict");
        setError("Some parameter sources changed elsewhere. Resolve each highlighted row.");
        return null;
      }
      if (bindingFingerprint(latest) === bindingFingerprint(rebased.workflow)) {
        setStatus("ready");
        return latest;
      }
      const saved = await workflowClient.save(workflowId, rebased.workflow, latest.revision);
      setBase(saved);
      setDraft(saved);
      setStatus("ready");
      return saved;
    } catch (reason) {
      setStatus("conflict");
      setError(reason instanceof Error ? reason.message : "The workflow changed again. Try saving once more.");
      return null;
    }
  }, [base, dirty, draft, workflowClient, workflowId]);

  const run = useCallback(async () => {
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const latest = await workflowClient.get(workflowId);
      setBase(latest);
      setDraft(latest);
      const preflight = resolveWorkflowParameters(latest, { profile });
      if (!preflight.canEnterPreflight) {
        setStatus("error");
        setError("Resolve the missing parameter values before running this workflow.");
        return;
      }
      const query = selectedProfileId
        ? `?profile=${encodeURIComponent(selectedProfileId)}`
        : "?run=1";
      navigate(`/workflows/${encodeURIComponent(workflowId)}/edit${query}`);
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "The workflow could not be prepared to run.");
    }
  }, [navigate, profile, saveDraft, selectedProfileId, workflowClient, workflowId]);

  const resolveConflict = useCallback((stepId: string, choice: "saved" | "local") => {
    const conflict = conflicts.find((candidate) => candidate.stepId === stepId);
    if (!conflict) return;
    if (choice === "local") updateBinding(stepId, conflict.local);
    const remaining = conflicts.filter((candidate) => candidate.stepId !== stepId);
    setConflicts(remaining);
    setError(remaining.length
      ? "Some parameter sources changed elsewhere. Resolve each highlighted row."
      : null);
    setStatus(remaining.length ? "conflict" : "ready");
  }, [conflicts, updateBinding]);

  return {
    workflow: draft,
    workflowLoading,
    profiles,
    profilesLoading,
    profilesError,
    selectedProfileId,
    selectProfile,
    profile,
    profileLoading,
    profileError,
    retryProfile,
    status,
    error,
    conflicts,
    dirty,
    parameterResult,
    updateBinding,
    autoMap: () => setDraft((current) => current ? autoMapParameters(current) : current),
    save: saveDraft,
    run,
    resolveConflict,
  };
}
