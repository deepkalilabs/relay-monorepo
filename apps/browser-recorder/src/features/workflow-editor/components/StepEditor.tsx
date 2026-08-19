"use client";

import { useMemo } from "react";
import { AlertCircle, ChevronRight, Crosshair, KeyRound, MousePointer2, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ReplayStepResultState } from "@/shared/contracts/protocol";
import {
  locatorKinds,
  MAX_ASSERTION_TEXT_LENGTH,
  isGroupExistsAssertion,
  type LocatorCandidate,
  type ViewportPosition,
  type WorkflowStep,
} from "@/shared/contracts/workflow/domain";
import { WorkflowStepSchema } from "@/shared/contracts/workflow/schema";

interface StepEditorProps {
  step: WorkflowStep | null;
  onUpdate: (step: WorkflowStep) => void;
  onCollapse?: () => void;
  locked?: boolean;
  reviewLocked?: boolean;
  replayResult?: ReplayStepResultState;
  onRunFromHere?: () => void;
}

export function StepEditor({ step, onUpdate, onCollapse, locked = false, reviewLocked = false, replayResult, onRunFromHere }: StepEditorProps) {
  const validation = useMemo(() => (step ? WorkflowStepSchema.safeParse(step) : null), [step]);
  const actionStep = step?.type === "assertion" ? null : step;
  const updatePayload = (key: string, value: unknown) => actionStep && onUpdate({ ...actionStep, payload: { ...actionStep.payload, [key]: value } } as WorkflowStep);
  const candidates = step?.target?.candidates ?? [];
  const updateCandidate = (index: number, patch: Partial<LocatorCandidate>) => {
    if (!step?.target) return;
    const next = candidates.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate);
    onUpdate({ ...step, target: { ...step.target, candidates: next } } as WorkflowStep);
  };
  const removeCandidate = (index: number) => {
    if (!step?.target) return;
    onUpdate({ ...step, target: { ...step.target, candidates: candidates.filter((_, candidateIndex) => candidateIndex !== index) } } as WorkflowStep);
  };
  const updatePosition = (patch: Partial<ViewportPosition>) => {
    if (!step?.position) return;
    onUpdate({ ...step, position: { ...step.position, ...patch } } as WorkflowStep);
  };
  const removePosition = () => {
    if (!step?.position) return;
    const next = { ...step };
    delete next.position;
    onUpdate(next as WorkflowStep);
  };
  const waitCandidates = actionStep?.waitAfter?.condition?.target.candidates ?? [];
  const updateWait = (delayMs: number, condition = actionStep?.waitAfter?.condition) => {
    if (!actionStep) return;
    if (delayMs <= 0 && !condition) {
      const withoutWait = { ...actionStep };
      delete withoutWait.waitAfter;
      onUpdate(withoutWait as WorkflowStep);
      return;
    }
    onUpdate({ ...actionStep, waitAfter: { ...(delayMs > 0 ? { delayMs } : {}), ...(condition ? { condition } : {}) } } as WorkflowStep);
  };
  const updateWaitCandidate = (index: number, patch: Partial<LocatorCandidate>) => {
    const condition = actionStep?.waitAfter?.condition;
    if (!condition) return;
    updateWait(actionStep?.waitAfter?.delayMs ?? 0, {
      ...condition,
      target: {
        ...condition.target,
        candidates: waitCandidates.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate),
      },
    });
  };
  const updateWaitConditionState = (state: "" | "visible" | "hidden") => {
    if (!state) {
      updateWait(actionStep?.waitAfter?.delayMs ?? 0, undefined);
      return;
    }
    const current = actionStep?.waitAfter?.condition;
    updateWait(actionStep?.waitAfter?.delayMs ?? 0, current
      ? { ...current, state }
      : { state, target: { candidates: [{ kind: "css", value: "", exact: true }] } });
  };

  return (
    <div className="step-editor-content">
      <header className="inspector-header">
        <div>
          <span className="eyebrow">Step details</span>
          <h2>{step ? `Step ${step.order + 1}` : "No step selected"}{step ? <span>{step.type}</span> : null}</h2>
        </div>
        <button id="inspector-collapse" className="icon-button" type="button" disabled={reviewLocked} onClick={onCollapse} aria-label="Collapse step details" title="Collapse details">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </header>
      {step ? (
        <div className="inspector-scroll">
          <button className="button button-secondary run-from-here" type="button" disabled={locked || !step.enabled} onClick={onRunFromHere}><Play size={15} /> Run from here</button>
          {replayResult ? (
            <section className={`replay-result replay-result-${replayResult.status}`} aria-labelledby="replay-result-title">
              <div id="replay-result-title" className="editor-section-title"><span>Replay result</span><small>{replayResult.phase ?? replayResult.status}</small></div>
              {replayResult.durationMs !== undefined ? <p>{replayResult.durationMs} ms{replayResult.locatorKind ? ` · ${replayResult.locatorKind} locator` : ""}</p> : null}
              {replayResult.diagnostic ? <><strong>{replayResult.diagnostic.message}</strong>{replayResult.diagnostic.attemptedLocators.length ? <ul>{replayResult.diagnostic.attemptedLocators.map((attempt, index) => <li key={`${attempt.kind}-${index}`}><code>{attempt.kind}</code> — {attempt.reason}</li>)}</ul> : null}</> : null}
            </section>
          ) : null}
          <fieldset className="editor-fieldset" disabled={locked}>
          <section className="editor-section action-editor" aria-labelledby="action-details-title">
            <div id="action-details-title" className="editor-section-title">
              {step.type === "assertion" ? <ShieldCheck size={15} /> : <MousePointer2 size={15} />}
              <span>{step.type === "assertion" ? "Assertion" : "Action"}</span>
            </div>
            <div className="editor-fields">
              <label className="field field-wide"><span>Step name</span><input value={step.name} onChange={(event) => onUpdate({ ...step, name: event.target.value } as WorkflowStep)} /></label>
              <label className="field"><span>Step type</span><input value={step.type} readOnly aria-readonly="true" /></label>
              <label className="toggle-field"><input type="checkbox" checked={step.enabled} onChange={(event) => onUpdate({ ...step, enabled: event.target.checked } as WorkflowStep)} /><span>Enabled</span></label>
              {step.type === "navigate" ? <label className="field field-wide"><span>Destination URL</span><input value={step.payload.url} onChange={(event) => updatePayload("url", event.target.value)} /></label> : null}
              {step.type === "fill" || step.type === "set_date" || step.type === "select" ? <label className="field field-wide"><span>{step.type === "fill" ? "Recorded value" : step.type === "set_date" ? "Selected date" : "Selected value"}</span><input value={step.payload.value} onChange={(event) => updatePayload("value", event.target.value)} /></label> : null}
              {step.type === "keypress" ? <>
                <label className="field"><span>Key</span><input value={step.payload.key} onChange={(event) => updatePayload("key", event.target.value)} /></label>
                <div className="key-preview"><KeyRound size={14} />{[...step.payload.modifiers, step.payload.key].join(" + ")}</div>
              </> : null}
              {step.type === "assertion" && isGroupExistsAssertion(step) ? <>
                <label className="field field-wide"><span>Expectation</span><input value="Group exists" readOnly aria-readonly="true" /></label>
                <label className="field"><span>Root element</span><input value={step.groupTarget.root.tagName} readOnly aria-readonly="true" /></label>
                <label className="field"><span>Root role</span><input value={step.groupTarget.root.role ?? "None"} readOnly aria-readonly="true" /></label>
                <label className="field"><span>Captured matches</span><input value={step.groupTarget.capturedMatchCount} readOnly aria-readonly="true" /></label>
                <label className="field"><span>Matcher</span><input value={step.groupTarget.algorithm} readOnly aria-readonly="true" /></label>
                <label className="field field-wide"><span>Structural tokens</span><textarea value={step.groupTarget.structureTokens.join("\n")} readOnly aria-readonly="true" rows={Math.min(8, step.groupTarget.structureTokens.length)} /></label>
              </> : step.type === "assertion" ? <>
                <label className="field field-wide">
                  <span>Expectation</span>
                  <select
                    value={step.expectation.kind}
                    onChange={(event) => onUpdate({
                      ...step,
                      expectation: event.target.value === "text_contains"
                        ? { kind: "text_contains", expected: "" }
                        : { kind: "visible" },
                    })}
                  >
                    <option value="visible">Element is visible</option>
                    <option value="text_contains">Text contains</option>
                  </select>
                </label>
                {step.expectation.kind === "text_contains" ? (
                  <div className="field field-wide">
                    <label htmlFor={`assertion-expected-${step.id}`}>Expected text</label>
                    <input
                      id={`assertion-expected-${step.id}`}
                      aria-describedby={`assertion-expected-help-${step.id}`}
                      maxLength={MAX_ASSERTION_TEXT_LENGTH}
                      value={step.expectation.expected}
                      onChange={(event) => onUpdate({ ...step, expectation: { kind: "text_contains", expected: event.target.value } })}
                    />
                    <small id={`assertion-expected-help-${step.id}`}>Matching ignores case and repeated whitespace.</small>
                  </div>
                ) : null}
              </> : null}
            </div>
          </section>
          {step.position ? <>
            <div className="editor-divider" />
            <section className="editor-section position-before-editor" aria-labelledby="position-before-title">
              <div id="position-before-title" className="editor-section-title"><span>Position before {step.type === "assertion" ? "check" : "action"}</span><small>{step.position.frameUrl ? "child frame" : "main frame"}</small></div>
              <div className="locator-card">
                <div className="locator-card-heading">
                  <span>{step.position.frameUrl ? "Child frame viewport" : "Main frame viewport"}</span>
                  <button className="mini-button danger-hover" type="button" aria-label="Remove step position" onClick={removePosition}><Trash2 size={14} /></button>
                </div>
                <div className="editor-fields">
                  <label className="field"><span>Horizontal position (px)</span><input type="number" value={step.position.x} onChange={(event) => updatePosition({ x: Number(event.target.value) })} /></label>
                  <label className="field"><span>Vertical position (px)</span><input type="number" value={step.position.y} onChange={(event) => updatePosition({ y: Number(event.target.value) })} /></label>
                  {step.position.frameUrl ? <label className="field field-wide"><span>Frame URL</span><input value={step.position.frameUrl} readOnly aria-readonly="true" /></label> : null}
                </div>
              </div>
            </section>
          </> : null}
          <div className="editor-divider" />
          <section className="editor-section locator-editor" aria-labelledby="locator-details-title">
            <div id="locator-details-title" className="editor-section-title"><Crosshair size={15} /><span>Locator candidates</span><small>{candidates.length}</small></div>
            {step.type === "assertion" && isGroupExistsAssertion(step) ? (
              <p className="muted-copy">This assertion uses a read-only structural group template instead of element locators.</p>
            ) : step.target ? (
              <div className="locator-list">
                {candidates.map((candidate, index) => (
                  <div className="locator-card" key={`${candidate.kind}-${index}`}>
                    <div className="locator-card-heading">
                      <span className="locator-rank">{index + 1}</span>
                      <label className="locator-kind"><span className="sr-only">Locator kind</span><select value={candidate.kind} onChange={(event) => updateCandidate(index, { kind: event.target.value as LocatorCandidate["kind"] })}>{locatorKinds.map((kind) => <option value={kind} key={kind}>{kind}</option>)}</select></label>
                      <button className="mini-button danger-hover" type="button" aria-label={`Remove locator ${index + 1}`} onClick={() => removeCandidate(index)}><Trash2 size={14} /></button>
                    </div>
                    <label className="field locator-value"><span>Value</span><input value={candidate.value} onChange={(event) => updateCandidate(index, { value: event.target.value })} /></label>
                    {candidate.kind === "role" ? <label className="field locator-name"><span>Accessible name</span><input value={candidate.name ?? ""} onChange={(event) => updateCandidate(index, { name: event.target.value })} /></label> : null}
                  </div>
                ))}
                <button className="text-button add-locator" type="button" onClick={() => step.target && onUpdate({ ...step, target: { ...step.target, candidates: [...candidates, { kind: "css", value: "body", exact: true }] } } as WorkflowStep)}><Plus size={14} /> Add locator</button>
              </div>
            ) : <p className="muted-copy">Navigation steps do not require an element locator.</p>}
          </section>
          {actionStep ? <>
          <div className="editor-divider" />
          <section className="editor-section replay-wait-editor" aria-labelledby="replay-wait-title">
            <div id="replay-wait-title" className="editor-section-title"><span>Replay wait</span><small>after action</small></div>
            <div className="editor-fields">
              <label className="field field-wide">
                <span>Additional delay (ms)</span>
                <input
                  type="number"
                  min={0}
                  max={30_000}
                  step={100}
                  value={actionStep?.waitAfter?.delayMs ?? 0}
                  onChange={(event) => updateWait(Math.max(0, Math.min(30_000, Number(event.target.value) || 0)))}
                />
              </label>
              <label className="field field-wide">
                <span>Element condition</span>
                <select value={actionStep?.waitAfter?.condition?.state ?? ""} onChange={(event) => updateWaitConditionState(event.target.value as "" | "visible" | "hidden")}>
                  <option value="">No element condition</option>
                  <option value="visible">Wait until visible</option>
                  <option value="hidden">Wait until hidden</option>
                </select>
              </label>
            </div>
            {actionStep?.waitAfter?.condition ? (
              <div className="locator-list replay-wait-locators">
                <label className="field">
                  <span>Frame URL (optional)</span>
                  <input
                    value={actionStep.waitAfter.condition.target.frameUrl ?? ""}
                    onChange={(event) => updateWait(actionStep.waitAfter?.delayMs ?? 0, {
                      ...actionStep.waitAfter!.condition!,
                      target: { ...actionStep.waitAfter!.condition!.target, frameUrl: event.target.value || undefined },
                    })}
                  />
                </label>
                {waitCandidates.map((candidate, index) => (
                  <div className="locator-card" key={`wait-${candidate.kind}-${index}`}>
                    <div className="locator-card-heading">
                      <span className="locator-rank">{index + 1}</span>
                      <label className="locator-kind"><span className="sr-only">Wait locator kind</span><select value={candidate.kind} onChange={(event) => updateWaitCandidate(index, { kind: event.target.value as LocatorCandidate["kind"] })}>{locatorKinds.map((kind) => <option value={kind} key={kind}>{kind}</option>)}</select></label>
                      <button className="mini-button danger-hover" type="button" aria-label={`Remove wait locator ${index + 1}`} onClick={() => {
                        const condition = actionStep.waitAfter?.condition;
                        if (!condition) return;
                        updateWait(actionStep.waitAfter?.delayMs ?? 0, { ...condition, target: { ...condition.target, candidates: waitCandidates.filter((_, candidateIndex) => candidateIndex !== index) } });
                      }}><Trash2 size={14} /></button>
                    </div>
                    <label className="field locator-value"><span>Value</span><input value={candidate.value} onChange={(event) => updateWaitCandidate(index, { value: event.target.value })} /></label>
                    {candidate.kind === "role" ? <label className="field locator-name"><span>Accessible name</span><input value={candidate.name ?? ""} onChange={(event) => updateWaitCandidate(index, { name: event.target.value })} /></label> : null}
                  </div>
                ))}
                <button className="text-button add-locator" type="button" onClick={() => {
                  const condition = actionStep.waitAfter?.condition;
                  if (!condition) return;
                  updateWait(actionStep.waitAfter?.delayMs ?? 0, { ...condition, target: { ...condition.target, candidates: [...waitCandidates, { kind: "css", value: "", exact: true }] } });
                }}><Plus size={14} /> Add wait locator</button>
              </div>
            ) : <p className="muted-copy">Smart DOM and network settling runs automatically after every replayed action.</p>}
          </section>
          </> : null}
          {validation && !validation.success ? <div className="validation-summary" role="alert"><AlertCircle size={15} /><span>{validation.error.issues[0]?.message}</span></div> : null}
          </fieldset>
        </div>
      ) : (
        <div className="editor-empty">
          <MousePointer2 size={20} aria-hidden="true" />
          <div><strong>Select a step to inspect it</strong><span>Action details and locator candidates will appear here.</span></div>
        </div>
      )}
    </div>
  );
}
