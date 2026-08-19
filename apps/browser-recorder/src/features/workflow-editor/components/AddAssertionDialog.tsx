"use client";

import { useState } from "react";
import { FileSearch, MousePointer2, ShieldCheck } from "lucide-react";
import type { BrowserPageState } from "@/shared/contracts/protocol";
import { MAX_ASSERTION_TEXT_LENGTH, type AssertionStep } from "@/shared/contracts/workflow/domain";
import { WorkflowStepSchema } from "@/shared/contracts/workflow/schema";
import { Modal } from "@/shared/ui/modal";

interface AddAssertionDialogProps {
  open: boolean;
  order: number;
  page: BrowserPageState | null;
  onClose: () => void;
  onPickTarget: () => void;
  onInsert: (step: AssertionStep) => void;
}

export function AddAssertionDialog(props: AddAssertionDialogProps) {
  if (!props.open) return null;
  return <AddAssertionDialogContent {...props} />;
}

function AddAssertionDialogContent({ order, page, onClose, onPickTarget, onInsert }: AddAssertionDialogProps) {
  const [mode, setMode] = useState<"choose" | "page-text">("choose");
  const [name, setName] = useState("Page contains text");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState("");

  const submitPageText = () => {
    if (!page) {
      setError("A current browser page is required.");
      return;
    }
    const candidate = {
      id: crypto.randomUUID(),
      order,
      name,
      enabled: true,
      page: { id: page.pageId, url: page.url, title: page.title },
      expectation: { kind: "page_text_contains" as const, expected },
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

  if (mode === "page-text") {
    return (
      <Modal
        open
        title="Add page text assertion"
        description="Replay will search the visible text in the current page and its inspectable frames."
        onClose={onClose}
      >
        <div className="modal-form">
          <div className="field">
            <label htmlFor="page-text-assertion-name">Step name</label>
            <input
              id="page-text-assertion-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="page-text-assertion-expected">Expected text</label>
            <input
              id="page-text-assertion-expected"
              aria-describedby="page-text-assertion-help"
              maxLength={MAX_ASSERTION_TEXT_LENGTH}
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
            />
            <small id="page-text-assertion-help">Matching ignores case and repeated whitespace.</small>
          </div>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-actions assertion-form-actions">
          <button className="button button-ghost" type="button" onClick={() => {
            setError("");
            setMode("choose");
          }}>
            Back
          </button>
          <span className="assertion-form-spacer" aria-hidden="true" />
          <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="button" onClick={submitPageText}>
            <ShieldCheck size={16} aria-hidden="true" /> Add assertion
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Add assertion"
      description="Choose what replay should verify at this point in the workflow."
      onClose={onClose}
    >
      <div className="assertion-choice-list">
        <button
          className="assertion-choice"
          type="button"
          disabled={!page}
          onClick={() => setMode("page-text")}
          autoFocus
        >
          <span className="assertion-choice-icon"><FileSearch size={20} aria-hidden="true" /></span>
          <span>
            <strong>Page contains text</strong>
            <small>Search visible page and frame text without selecting an element.</small>
          </span>
        </button>
        <button
          className="assertion-choice"
          type="button"
          onClick={() => {
            onClose();
            onPickTarget();
          }}
        >
          <span className="assertion-choice-icon"><MousePointer2 size={20} aria-hidden="true" /></span>
          <span>
            <strong>Select element or group</strong>
            <small>Pick a visible target in the live browser.</small>
          </span>
        </button>
      </div>
    </Modal>
  );
}
