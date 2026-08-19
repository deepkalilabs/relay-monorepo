# Browser Memory Recorder MVP

**Frontend Product and Technical Design Document**

> **Historical document.** This specification records the original MVP target. Several deferred capabilities, including local persistence and profiles, have since shipped. Use the active [product roadmap](./roadmap.md) for current priorities and sequencing.

## 1. Overview

Browser Memory Recorder is a browser-first workflow capture application.

Users interact with a real cloud-hosted browser inside the product. As they navigate, click, type, and submit forms, the application converts those interactions into structured workflow steps.

The MVP focuses on validating three ideas:

1. Users can interact naturally with an embedded remote browser.
2. Browser interactions can be captured as semantic actions.
3. Those actions can be reviewed, edited, and exported as a workflow.

Backend persistence, user accounts, collaboration, and large-scale execution infrastructure are intentionally deferred.

---

# 2. Product Vision

Traditional browser automation starts with scripts.

Browser Memory Recorder starts with human behavior.

```text
User performs task
        ↓
Recorder observes intent
        ↓
Structured workflow appears
        ↓
Workflow can be edited
        ↓
Workflow can later be replayed
```

The browser is the main workspace. The workflow timeline and inspector support the browser rather than replacing it.

---

# 3. MVP Goals

The MVP should allow a user to:

* Launch an interactive Browserbase session.
* Browse websites from an embedded Live View.
* Start, pause, and stop recording.
* Capture navigation, click, fill, select, submit, and keyboard actions.
* See recorded actions appear immediately in a timeline.
* Select a step and inspect its target.
* Review the locator strategies associated with that target.
* Rename, remove, disable, or reorder steps.
* Export the workflow as JSON.
* Optionally replay the workflow in a fresh Browserbase session.

The primary success metric is not automation scale. It is whether the generated workflow accurately represents what the user intended to do.

---

# 4. Non-Goals

The first version does not include:

* User accounts
* Database persistence
* Team collaboration
* Workflow sharing
* Version history
* Scheduling
* Distributed execution
* Durable Objects
* Queues
* Cloud artifact storage
* AI locator repair
* Conditional branching
* Loops
* Multi-tab workflows
* Secret management
* Production-grade authorization
* Visual regression testing

These can be added after the recording experience is validated.

---

# 5. Core User Experience

## 5.1 Primary layout

The interface uses three major regions:

```text
┌──────────────────────────────────────────────────────────────┐
│ Application toolbar                                          │
├───────────────────┬──────────────────────────────────────────┤
│ Workflow timeline │ Interactive cloud browser                │
│                   │                                          │
│                   │ Browserbase Live View                    │
│                   │                                          │
├───────────────────┴──────────────────────────────────────────┤
│ Selected-step inspector                                      │
└──────────────────────────────────────────────────────────────┘
```

The browser should remain the visually dominant element.

Recommended width allocation:

```text
Timeline:       22–26%
Browser:        74–78%
```

The inspector should be collapsible so the browser can use most of the vertical space while recording.

---

# 6. User Interface Specification

## 6.1 Application toolbar

The toolbar contains:

* Product name
* Recording state
* Start or pause recording
* Stop recording
* Export
* Browser session health
* Browser region
* Appearance controls
* User menu placeholder

### Idle state

```text
Start Recording
Export
Browser Connected
```

### Recording state

```text
● Recording  00:42
Pause
Stop
```

### Replay state

```text
▶ Replaying step 4 of 12
Pause
Take Control
Stop
```

The toolbar should present only controls relevant to the current mode.

---

## 6.2 Browser panel

The browser panel embeds Browserbase Live View.

It must support:

* Mouse input
* Keyboard input
* Scrolling
* Navigation
* Clipboard access where supported
* Browser resizing
* Session reconnect
* Loading and failure states

The panel should visually resemble a lightweight browser frame, but it should not duplicate unnecessary Chrome controls if Browserbase already provides them.

### Browser states

```ts
type BrowserState =
  | "creating"
  | "connecting"
  | "ready"
  | "recording"
  | "replaying"
  | "paused"
  | "disconnected"
  | "completed"
  | "error";
```

### Recording indicator

While recording, display a subtle indicator near the browser frame:

```text
● Recording browser actions
```

Do not cover the webpage with a large overlay.

---

## 6.3 Workflow timeline

The left panel shows ordered workflow steps.

Example:

```text
1  Navigate
   vercel.com

2  Click
   Get Started

3  Fill
   Email address

4  Click
   Continue
```

Each step displays:

* Sequence number
* Action icon
* Action type
* Human-readable target
* Relative recording time
* Status
* Optional warning

### Step states

```ts
type StepState =
  | "recorded"
  | "selected"
  | "disabled"
  | "running"
  | "passed"
  | "failed"
  | "warning";
```

### Supported MVP actions

```ts
type ActionType =
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "keypress"
  | "submit"
  | "wait"
  | "assert";
```

### Timeline interactions

Users can:

* Select a step
* Rename a step
* Delete a step
* Disable a step
* Drag to reorder

These actions modify only local application state in the MVP.

---

## 6.4 Step inspector

Selecting a timeline step opens the inspector.

The inspector contains three areas:

```text
Step summary
Locator information
Element preview
```

### Step summary

Displays:

* Action type
* Human-readable label
* Timestamp
* URL
* Tab or frame
* Input value, when safe
* Recording metadata

Example:

```text
Click
Continue

Time: 00:06.143
URL: https://vercel.com/signup
Tab: 1
```

### Locator information

The default presentation should be simple:

```text
Target

Continue button

Confidence: High
Primary locator:
getByTestId("continue-button")
```

Additional strategies are shown under an expandable **Advanced locators** section.

```text
data-testid
role + accessible name
label
visible text
CSS selector
DOM path
coordinates
```

This prevents technical details from overwhelming users while preserving debugging value.

### Element preview

Displays a cropped visual representation of the selected element.

Include:

* Element bounding box
* Element type
* Dimensions
* Recorded click point
* Optional screenshot timestamp

Example:

```text
BUTTON

Continue

48 px × 16 px
Click point: 862, 512
```

---

# 7. Frontend Architecture

```text
Next.js application
│
├── Application shell
│
├── Browser workspace
│   ├── Browserbase Live View
│   ├── Session controls
│   └── Browser status
│
├── Recording controller
│   ├── DOM recorder injection
│   ├── Raw event collector
│   ├── Event normalizer
│   └── Locator generator
│
├── Workflow workspace
│   ├── Timeline
│   ├── Step editor
│   └── Export
│
└── Replay controller
    ├── Playwright executor
    ├── Locator resolver
    └── Step status
```

---

# 8. Browserbase Integration

Browserbase provides:

* Remote Chromium
* Interactive Live View
* Session creation
* Playwright/CDP connection
* Session observability
* Browser lifecycle management

The frontend embeds the Live View, while a server-side or local development controller connects Playwright to the same session.

```text
User
  ↓
Browserbase Live View
  ↓
Remote Chromium
  ↑
Playwright controller
  ↓
Recorder and replay logic
```

## Browser provider abstraction

Browserbase-specific code should remain behind an interface.

```ts
interface BrowserProvider {
  createSession(): Promise<BrowserSession>;
  getLiveViewUrl(sessionId: string): Promise<string>;
  getConnectUrl(sessionId: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
}
```

```ts
interface BrowserSession {
  id: string;
  liveViewUrl: string;
  connectUrl: string;
  status: "starting" | "ready" | "closed" | "error";
}
```

This preserves the option to support Cloudflare Browser Run later.

---

# 9. Recorder Architecture

## 9.1 Recording approach

The recorder is injected into every document before application scripts run.

```ts
await context.addInitScript({
  content: recorderScript,
});
```

The injected recorder observes semantic browser events.

```text
DOM interaction
     ↓
Raw event
     ↓
Target analysis
     ↓
Event normalization
     ↓
Workflow step
```

## 9.2 Events captured

Capture:

* Click
* Input completion
* Change
* Submit
* Navigation
* Important keypresses
* Checkbox changes
* Select changes
* SPA URL changes

Do not capture:

* Mouse movement
* Every keystroke
* Every scroll event
* Every DOM mutation
* Password contents
* Raw cookies
* Authentication tokens

## 9.3 Fill-event deduplication

Typing should generate one `fill` step, not one step per key.

Possible strategy:

```text
input event
     ↓
debounce for 500–800 ms
     ↓
record final field value
```

Record immediately when:

* Focus leaves the field
* Form submits
* Enter is pressed
* Navigation starts

---

# 10. Semantic Target Model

Every recorded action should contain multiple descriptions of the target.

```ts
interface TargetDescriptor {
  tagName: string;
  testId?: string;
  role?: string;
  accessibleName?: string;
  label?: string;
  text?: string;
  nameAttribute?: string;
  inputType?: string;
  placeholder?: string;
  css?: string;
  domPath?: string;
  framePath?: string[];
  boundingBox?: BoundingBox;
  clickPoint?: Point;
}
```

The target descriptor is evidence, not a single hard-coded selector.

---

# 11. Locator Generation

Locator priority:

1. Stable test ID
2. Accessible role and name
3. Associated label
4. Name attribute
5. Placeholder
6. Stable visible text
7. Stable CSS selector
8. DOM path
9. Coordinates

Example:

```json
{
  "primary": {
    "type": "testId",
    "value": "continue-button"
  },
  "alternatives": [
    {
      "type": "role",
      "role": "button",
      "name": "Continue"
    },
    {
      "type": "text",
      "value": "Continue"
    },
    {
      "type": "css",
      "value": "button[type='submit']"
    }
  ]
}
```

Selectors should be tested at recording time.

Store:

* Match count
* Uniqueness
* Visibility
* Confidence score

---

# 12. Workflow Data Model

```ts
interface Workflow {
  id: string;
  schemaVersion: 1;
  name: string;
  createdAt: string;
  startUrl?: string;
  steps: WorkflowStep[];
}
```

```ts
interface WorkflowStep {
  id: string;
  sequence: number;
  type: ActionType;
  title: string;
  target?: TargetDescriptor;
  locatorSet?: LocatorSet;
  value?: RecordedValue;
  page: PageContext;
  timestampMs: number;
  disabled: boolean;
  metadata?: StepMetadata;
}
```

```ts
interface PageContext {
  url: string;
  title?: string;
  tabIndex: number;
  framePath?: string[];
}
```

```ts
type RecordedValue =
  | { kind: "plain"; value: string }
  | { kind: "redacted" }
  | { kind: "secret-reference"; key: string };
```

---

# 13. Local State Management

The MVP stores state in the browser.

Recommended state:

```ts
interface AppState {
  browserSession?: BrowserSession;
  mode: "idle" | "recording" | "paused" | "replaying";
  workflow: Workflow;
  selectedStepId?: string;
  replayState?: ReplayState;
}
```

Use:

* React state for component-local UI state
* Zustand for shared application state
* Local storage only for optional recovery
* Downloaded JSON for explicit persistence

No database is required.

---

# 14. Export and Import

## Export

The user can export the current workflow as JSON.

```text
workflow-name.browser-memory.json
```

The exported document includes:

* Schema version
* Workflow metadata
* Ordered steps
* Locators
* Page context
* Redaction markers

It must not include:

* Raw passwords
* Browser cookies
* Authorization headers
* Session connection URLs

## Import

Import can be added within the MVP if replay is included.

The importer should:

1. Validate schema version.
2. Validate every step.
3. Reject unsupported actions.
4. Show errors without partially corrupting state.
5. Generate missing local IDs when necessary.

---

# 15. Replay Design

Replay can be included as the second MVP milestone.

```text
Workflow
   ↓
Fresh Browserbase session
   ↓
Playwright executor
   ↓
Resolve target
   ↓
Perform action
   ↓
Verify result
   ↓
Update timeline
```

## Execution states

```ts
interface ReplayState {
  status: "idle" | "running" | "paused" | "passed" | "failed";
  currentStepId?: string;
  results: ReplayStepResult[];
}
```

## Locator resolution

For each step:

1. Try the primary locator.
2. Verify it resolves to one visible element.
3. Try alternative locators.
4. Reject ambiguous matches.
5. Use coordinates only as an explicit fallback.
6. Fail with clear diagnostic information.

## Timing

Do not replay recorded timing exactly.

Use Playwright readiness:

* Element visible
* Element enabled
* Navigation complete
* Network idle where appropriate
* Expected URL reached
* Expected element displayed

---

# 16. Security and Privacy

Even without backend persistence, recording creates privacy risks.

The recorder must:

* Redact password fields
* Redact fields marked `data-sensitive`
* Avoid recording cookies
* Avoid recording local-storage values
* Avoid sending page contents to third parties
* Avoid capturing credit-card fields
* Allow users to delete a recorded step
* Clearly indicate when recording is active

Suggested redaction logic:

```text
input[type=password]
autocomplete=current-password
autocomplete=new-password
autocomplete=cc-number
autocomplete=cc-csc
[data-sensitive]
```

Sensitive fields should produce:

```json
{
  "kind": "redacted"
}
```

---

# 17. Error States

The UI should handle:

## Browser session failure

```text
Unable to connect to cloud browser

Retry
Create new session
```

## Recorder injection failure

```text
Recording is limited on this page

Some browser or cross-origin content may not be captured.
```

## Ambiguous selector

```text
Target may not replay reliably

3 matching buttons were found.
Review locator
```

## Replay failure

```text
Step 6 failed

Could not locate:
"Create Account" button

Review target
Skip step
Take control
Stop replay
```

---

# 18. Recommended File Structure

```text
src/
├── app/
│   ├── page.tsx
│   └── workspace/
│
├── components/
│   ├── app-toolbar/
│   ├── browser-panel/
│   ├── workflow-timeline/
│   ├── step-inspector/
│   └── element-preview/
│
├── browser/
│   ├── BrowserProvider.ts
│   ├── BrowserbaseProvider.ts
│   ├── session.ts
│   └── types.ts
│
├── recorder/
│   ├── injected-recorder.ts
│   ├── event-collector.ts
│   ├── event-normalizer.ts
│   ├── locator-generator.ts
│   ├── redaction.ts
│   └── types.ts
│
├── workflow/
│   ├── schema.ts
│   ├── builder.ts
│   ├── editor.ts
│   ├── export.ts
│   └── import.ts
│
├── replay/
│   ├── executor.ts
│   ├── locator-resolver.ts
│   ├── actions.ts
│   └── results.ts
│
├── store/
│   └── workspace-store.ts
│
└── utils/
```

---

# 19. MVP Milestones

## Milestone 1: Browser workspace

* Create Browserbase session
* Embed interactive Live View
* Show session state
* Handle reconnect and close

## Milestone 2: Recording

* Inject recorder
* Capture navigation
* Capture click
* Capture fill
* Capture select and checkbox
* Populate live timeline
* Redact sensitive fields

## Milestone 3: Editing

* Select step
* Rename step
* Delete step
* Disable step
* Reorder steps
* Inspect locator information
* Show element preview

## Milestone 4: Export

* Validate workflow
* Export JSON
* Import JSON
* Recover recent workflow from local storage

## Milestone 5: Replay

* Create fresh browser session
* Execute supported actions
* Show current step
* Pause or stop replay
* Show failure diagnostics

---

# 20. MVP Acceptance Criteria

The MVP is complete when:

1. A user can launch an interactive Browserbase browser.
2. The user can navigate and interact normally.
3. Recorded actions appear in the timeline within one second.
4. Text input produces one semantic `fill` action.
5. Password contents are never displayed or exported.
6. Clicking a step shows its target and locator evidence.
7. Steps can be renamed, removed, disabled, and reordered.
8. The workflow can be exported as valid versioned JSON.
9. An exported workflow can be imported without losing structure.
10. A basic workflow can be replayed in a fresh browser session.

---

# 21. UI-Specific Recommendations

The current visual direction fits the MVP well. The following refinements should be incorporated:

* Keep the browser as the largest surface.
* Make the bottom inspector collapsible.
* Hide advanced locator strategies by default.
* Remove the architecture diagram from the shipping workspace.
* Add immediate “step captured” feedback.
* Change toolbar controls based on mode.
* Use subtle recording and replay status indicators.
* Keep action labels human-readable rather than Playwright-specific.
* Preserve the element preview because it strongly improves trust.
* Use workflow grouping later, but keep the first version linear.

---

# 22. Future Evolution

After validating the frontend experience:

```text
Frontend MVP
    ↓
Persistence
    ↓
Authentication
    ↓
Cloud replay workers
    ↓
Assertions and variables
    ↓
Locator healing
    ↓
Reusable workflow blocks
    ↓
Team collaboration
```

The long-term product should evolve from a flat event timeline into browser memory:

```text
Low-level actions
       ↓
Task segments
       ↓
Reusable subflows
       ↓
Intent-aware workflows
```

The MVP should keep the underlying event structure sufficiently rich to support that evolution without prematurely introducing AI or backend complexity.
