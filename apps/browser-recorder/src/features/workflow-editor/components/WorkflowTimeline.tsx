"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  CalendarDays,
  ChevronLeft,
  ChevronsUpDown,
  CircleDashed,
  GripVertical,
  Keyboard,
  Link2,
  LoaderCircle,
  MousePointer2,
  Plus,
  Send,
  ShieldCheck,
  SkipForward,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import type { ReplayStepResultState } from "@/shared/contracts/protocol";
import type { WorkflowStep } from "@/shared/contracts/workflow/domain";

const icons = {
  navigate: Link2,
  click: MousePointer2,
  fill: TextCursorInput,
  set_date: CalendarDays,
  select: ChevronsUpDown,
  check: CheckSquare,
  uncheck: CheckSquare,
  keypress: Keyboard,
  submit: Send,
  assertion: ShieldCheck,
};

interface TimelineProps {
  steps: WorkflowStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (step: WorkflowStep) => void;
  onDelete: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
  onAddAssertion: () => void;
  assertionAvailable: boolean;
  onCollapse: () => void;
  replayResults?: Record<string, ReplayStepResultState>;
  locked?: boolean;
  reviewLocked?: boolean;
}

const replayIcons = {
  pending: CircleDashed,
  running: LoaderCircle,
  passed: CheckCircle2,
  failed: AlertTriangle,
  skipped: SkipForward,
};

function SortableStep({ step, selected, result, locked, reviewLocked, onSelect, onToggle, onDelete }: {
  step: WorkflowStep;
  selected: boolean;
  result?: ReplayStepResultState;
  locked: boolean;
  reviewLocked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled: locked });
  const Icon = icons[step.type];
  const ResultIcon = result ? replayIcons[result.status] : null;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`timeline-step ${selected ? "selected" : ""} ${!step.enabled ? "disabled-step" : ""} ${result ? `replay-${result.status}` : ""} ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" type="button" disabled={locked} aria-label={`Reorder step ${step.order + 1}`} {...attributes} {...listeners}>
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <button id={`workflow-step-${step.id}`} className="step-main" type="button" disabled={reviewLocked} onClick={onSelect} aria-pressed={selected}>
        <span className="step-icon"><Icon size={15} aria-hidden="true" /></span>
        <span className="step-copy">
          <span className="step-title">{step.name}</span>
          <span className="step-meta">{step.order + 1} · {step.type}{result ? ` · ${result.phase ?? result.status}` : ""}</span>
        </span>
        {ResultIcon ? <span className={`replay-step-status replay-step-status-${result?.status}`}><ResultIcon className={result?.status === "running" ? "spin" : undefined} size={16} aria-hidden="true" /><span className="sr-only">Replay {result?.status}</span></span> : null}
      </button>
      <div className="step-actions">
        <button className="mini-button" type="button" disabled={locked} onClick={onToggle} aria-label={step.enabled ? `Disable ${step.name}` : `Enable ${step.name}`} title={step.enabled ? "Disable" : "Enable"}>
          <span className={`enabled-indicator ${step.enabled ? "on" : ""}`} aria-hidden="true" />
        </button>
        <button className="mini-button danger-hover" type="button" disabled={locked} onClick={onDelete} aria-label={`Delete ${step.name}`} title="Delete"><Trash2 size={14} /></button>
      </div>
    </li>
  );
}

export function WorkflowTimeline({ steps, selectedId, onSelect, onToggle, onDelete, onReorder, onAddAssertion, assertionAvailable, onCollapse, replayResults = {}, locked = false, reviewLocked = false }: TimelineProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) onReorder(String(event.active.id), String(event.over.id));
  };
  return (
    <aside className="timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Workflow</span>
          <h2 id="timeline-title">Workflow steps <span>{steps.length}</span></h2>
        </div>
        <div className="panel-heading-actions">
          <button className="icon-button" type="button" disabled={locked || !assertionAvailable} onClick={onAddAssertion} aria-label="Add assertion" title="Add assertion">
            <Plus size={18} aria-hidden="true" />
          </button>
          <button id="timeline-collapse" className="icon-button" type="button" disabled={reviewLocked} onClick={onCollapse} aria-label="Collapse workflow timeline" title="Collapse timeline">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {steps.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
            <ol className="timeline-list">
              {steps.map((step) => (
                <SortableStep
                  key={step.id}
                  step={step}
                  selected={selectedId === step.id}
                  result={replayResults[step.id]}
                  locked={locked}
                  reviewLocked={reviewLocked}
                  onSelect={() => onSelect(step.id)}
                  onToggle={() => onToggle({ ...step, enabled: !step.enabled })}
                  onDelete={() => onDelete(step.id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="timeline-empty">
          <span className="empty-illustration"><MousePointer2 size={22} aria-hidden="true" /></span>
          <h3>Your steps will appear here</h3>
          <p>Start a recording and use the browser naturally. Your interactions become editable steps.</p>
        </div>
      )}
    </aside>
  );
}
