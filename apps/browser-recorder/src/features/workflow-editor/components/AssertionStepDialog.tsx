"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { AssertionPickState } from "@/shared/contracts/protocol";
import { MAX_ASSERTION_TEXT_LENGTH, type AssertionStep } from "@/shared/contracts/workflow/domain";
import { WorkflowStepSchema } from "@/shared/contracts/workflow/schema";
import { Modal } from "@/shared/ui/modal";

type SelectedAssertionTarget = Extract<AssertionPickState, { status: "selected" }>;

interface AssertionStepDialogProps {
  open: boolean;
  order: number;
  selection: SelectedAssertionTarget | null;
  onClose: () => void;
  onInsert: (step: AssertionStep) => void;
}

export function AssertionStepDialog({ open, order, selection, onClose, onInsert }: AssertionStepDialogProps) {
  if (!selection) return null;
  return selection.kind === "group"
    ? <GroupAssertionStepDialogForm key={selection.requestId} open={open} order={order} selection={selection} onClose={onClose} onInsert={onInsert} />
    : <ElementAssertionStepDialogForm key={selection.requestId} open={open} order={order} selection={selection} onClose={onClose} onInsert={onInsert} />;
}

type ElementAssertionSelection = Extract<SelectedAssertionTarget, { kind: "element" }>;
type GroupAssertionSelection = Extract<SelectedAssertionTarget, { kind: "group" }>;

function ElementAssertionStepDialogForm({ open, order, selection, onClose, onInsert }: Omit<AssertionStepDialogProps, "selection"> & { selection: ElementAssertionSelection }) {
  const hasText = Boolean(selection.text.trim());
  const [name, setName] = useState(() => hasText ? `${selection.name} contains text` : `${selection.name} is visible`);
  const [kind, setKind] = useState<"visible" | "text_contains">(() => hasText ? "text_contains" : "visible");
  const [expected, setExpected] = useState(() => selection.text);
  const [error, setError] = useState("");

  const submit = () => {
    const candidate = {
      id: crypto.randomUUID(),
      order,
      name,
      enabled: true,
      page: selection.page,
      target: selection.target,
      position: selection.position,
      expectation: kind === "text_contains" ? { kind, expected } : { kind },
      metadata: { recordedAt: new Date().toISOString(), origin: "manual" as const, sensitive: false },
      type: "assertion" as const,
    };
    const parsed = WorkflowStepSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.type !== "assertion") {
      setError(parsed.success ? "The assertion is invalid." : parsed.error.issues[0]?.message ?? "Check the assertion details.");
      return;
    }
    onInsert(parsed.data);
    onClose();
  };

  return (
    <Modal open={open} title="Add assertion" description={`Selected ${selection.name}. Choose what replay should check.`} onClose={onClose}>
      <div className="modal-form">
        <div className="field">
          <label htmlFor="assertion-step-name">Step name</label>
          <input id="assertion-step-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="assertion-expectation">Expectation</label>
          <select id="assertion-expectation" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="visible">Element is visible</option>
            <option value="text_contains">Text contains</option>
          </select>
        </div>
        {kind === "text_contains" ? (
          <div className="field">
            <label htmlFor="assertion-expected-text">Expected text</label>
            <input id="assertion-expected-text" aria-describedby="assertion-expected-help" maxLength={MAX_ASSERTION_TEXT_LENGTH} value={expected} onChange={(event) => setExpected(event.target.value)} />
            <small id="assertion-expected-help">Matching ignores case and repeated whitespace.</small>
          </div>
        ) : null}
        <p className="assertion-target-summary"><ShieldCheck size={15} aria-hidden="true" /> {selection.target.candidates?.length ?? 0} locator candidates captured</p>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
      <div className="modal-actions">
        <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="button" onClick={submit}><ShieldCheck size={16} /> Add assertion</button>
      </div>
    </Modal>
  );
}

function GroupAssertionStepDialogForm({ open, order, selection, onClose, onInsert }: Omit<AssertionStepDialogProps, "selection"> & { selection: GroupAssertionSelection }) {
  const [name, setName] = useState(() => `${selection.name} exists`);
  const [error, setError] = useState("");

  const submit = () => {
    const candidate = {
      id: crypto.randomUUID(),
      order,
      name,
      enabled: true,
      page: selection.page,
      groupTarget: selection.groupTarget,
      position: selection.position,
      expectation: { kind: "group_exists" as const },
      metadata: { recordedAt: new Date().toISOString(), origin: "manual" as const, sensitive: false },
      type: "assertion" as const,
    };
    const parsed = WorkflowStepSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.type !== "assertion") {
      setError(parsed.success ? "The assertion is invalid." : parsed.error.issues[0]?.message ?? "Check the assertion details.");
      return;
    }
    onInsert(parsed.data);
    onClose();
  };

  const rootSummary = [selection.groupTarget.root.tagName, selection.groupTarget.root.role]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal open={open} title="Add group assertion" description="Replay will pass when at least one visible container matches this structural template." onClose={onClose}>
      <div className="modal-form">
        <div className="field">
          <label htmlFor="group-assertion-step-name">Step name</label>
          <input id="group-assertion-step-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="group-assertion-expectation">Expectation</label>
          <input id="group-assertion-expectation" value="Group exists" readOnly aria-readonly="true" />
        </div>
        <p className="assertion-target-summary"><ShieldCheck size={15} aria-hidden="true" /> {selection.groupTarget.capturedMatchCount} matches captured</p>
        <p className="assertion-target-summary">{rootSummary} · {selection.groupTarget.structureTokens.length} structural tokens · {selection.groupTarget.algorithm}</p>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
      <div className="modal-actions">
        <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="button" onClick={submit}><ShieldCheck size={16} /> Add assertion</button>
      </div>
    </Modal>
  );
}
