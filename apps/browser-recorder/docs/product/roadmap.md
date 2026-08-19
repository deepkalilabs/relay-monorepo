# Browser Memory Recorder Product Roadmap

- Status: Active
- Last updated: 2026-08-03
- Planning style: Outcome-based; phases are sequenced but not date-bound

## Purpose

Browser Memory Recorder has moved beyond its original MVP. Recording, local workflow persistence, workflow editing, interactive replay, recovery controls, a workflow Library, and local profiles now exist.

The next goal is not to add automation breadth as quickly as possible. It is to make recorded workflows reusable, dependable, and safe enough to run repeatedly. This document is the canonical product roadmap. The original [MVP design](./mvp_design.md) remains historical context for the initial product and interaction model.

## Product Direction

Turn a successful browser recording into a reusable automation that a person can understand, trust, and eventually run without supervision.

The roadmap follows four product outcomes:

1. Reuse one workflow across people and contexts.
2. Make replay success and failure measurable and understandable.
3. Protect authentication state and sensitive values.
4. Support unattended execution after reliability and security are proven.

Market specialization follows evidence from real usage rather than preceding it.

## Current Foundation

The following capabilities are already shipped:

- Interactive Browserbase recording using semantic actions.
- Editable workflows with explicit local persistence and revision-conflict protection.
- A local workflow Library and workflow editor.
- Full or selected-step interactive replay.
- Replay settling, element waits, and Retry, Skip, Take Control, and Stop recovery.
- Manually authored element-visibility and text-containment assertions selected in the live browser.
- Replayable repeated-group existence assertions selected through a structural matching panel.
- Local profile creation, editing, readiness status, and deletion.
- Versioned workflow and profile contracts with compatibility handling.

Current constraints remain:

- Local, single-user storage.
- Desktop-first, linear, single-tab workflows.
- Explicit saving rather than autosave.
- Profile values and sensitive workflow values are stored locally in plain text.
- Assertions are currently limited to immediate element visibility, normalized text containment, and repeated-group existence.
- No run history, scheduling, remote execution, or collaboration.

## Roadmap Overview

| Horizon | Focus | Outcome |
| --- | --- | --- |
| **Now — Reusable workflows** | Complete the core workflow lifecycle | One saved workflow can be safely configured and run with different profiles |
| **Next — Reliability and trust** | Measure replay and explain failures | Users can determine what ran, what failed, why it failed, and how stable the workflow is |
| **Later — Authentication and data security** | Separate reusable identity, secrets, and browser state | Repeated authenticated runs do not require credentials inside workflow files |
| **Later — Unattended automation** | Add controlled background execution | Reliable workflows can run through schedules, APIs, and webhooks with operational safeguards |
| **Decision gate — Market direction** | Specialize based on observed demand | Investment focuses on personal productivity, team QA, or operations automation |

## Now: Reusable Workflows

### Outcome

A user can record a workflow once, configure it without reopening the recorder, and safely run it for multiple profiles.

### Planned Deliverables

#### Profile-parameterized runs

- Parameterize form-fill steps first.
- Support the existing profile-field vocabulary.
- Keep the latest edited step value as the explicit fallback.
- Allow a draft profile to run when every field referenced by the workflow is valid and present.
- Resolve profile values in memory immediately before replay.
- Never copy resolved profile values into workflow files or diagnostics.
- Validate mapped values before creating a browser session and identify missing fields clearly.

The detailed feature specification is [Profile-Parameterized Workflow Runs](./features/profile-parameterization.md).

#### Complete the Library workflow lifecycle

- Run a workflow from the Library, with or without a profile.
- Rename, duplicate, and permanently delete workflows.
- Import and export workflows from the Library.
- Protect unsaved changes when navigating, switching workflows, or starting a run.

### Exit Criteria

- A saved parameter mapping survives reload.
- The same workflow runs successfully with at least two profiles while retaining its saved fallback values.
- Missing mapped values prevent browser-session creation.
- Schema `1.2` workflows remain compatible; schema `1.0`/`1.1` workflows remain readable only when they contain no fill steps.
- A user can manage the common workflow lifecycle without reopening the recording workspace unnecessarily.

## Next: Reliability and Trust

### Outcome

Replay becomes measurable and failures become actionable instead of opaque.

### Planned Deliverables

#### Expand assertions

Extend the initial element assertions with:

- Current URL.
- Page title.

#### Run records and failure evidence

- Store a local, sanitized run record with outcome, duration, failed step, and recovery result.
- Capture useful failure evidence such as screenshots, Browserbase session links, or video where available and appropriate.
- Redact sensitive values from evidence and diagnostics.

#### Locator health

- Record which locator candidate succeeded during replay.
- Warn when a workflow depends on fragile CSS or XPath fallbacks.
- Make locator degradation visible before it becomes a complete failure.

#### Reliability measurement

- Maintain a representative regression set of approximately 10–20 workflows.
- Track replay success rate, recovery rate, execution duration, and Browserbase cost per successful run.
- Track time from recording to first successful replay and the number of workflows reused with multiple profiles.

### Exit Criteria

- Every run produces a clear, sanitized outcome.
- A failed run identifies the failed step and provides useful evidence.
- Representative workflow reliability is measured continuously.
- Reliability and cost thresholds for unattended execution are defined from observed results.

## Later: Authentication and Data Security

### Outcome

Users can reuse authenticated sessions and sensitive values without embedding credentials in workflows.

### Data Boundaries

- **Profiles:** reusable personal and form information such as names, addresses, and phone numbers.
- **Secrets:** encrypted credentials, tokens, authentication codes, and payment information referenced by identifier.
- **Browser contexts:** reusable cookies, local storage, and session state associated with a site and account.

### Planned Deliverables

- Reusable authenticated browser contexts.
- Encrypted secret storage with indirect references.
- Typed workflow variables with explicit value sources.
- Sensitive-value redaction across logs, screenshots, diagnostics, exports, and errors.
- Explicit authorization before a workflow can access a secret or authenticated context.

### Exit Criteria

- Raw credentials are absent from workflow JSON.
- Secrets are encrypted at rest and redacted from all diagnostic surfaces.
- Profiles, secrets, workflows, and browser contexts have distinct storage and access boundaries.
- Revoking a secret or browser context does not require editing workflow definitions.

## Later: Unattended Automation

### Outcome

Proven workflows can run without an active operator while remaining controllable and cost-aware.

### Planned Deliverables

- Headless workflow runner.
- Scheduled, webhook, and API-triggered execution.
- Success and failure notifications.
- Configurable retries, timeouts, cancellation, and recovery.
- Concurrency and usage controls.
- Execution cost and resource visibility.

### Entry Gate

Unattended execution begins only after:

- Representative replay reliability is measured and meets an explicit threshold.
- Run records and failure evidence are available.
- Sensitive values and authentication state use the security boundaries above.
- Usage and Browserbase cost limits can be enforced.

## Decision Gate: Market Direction

The product remains broad only long enough to learn which workflows users repeat and pay to automate. The leading directions are:

- **Personal productivity:** a local-first tool for individual browser automation.
- **Team QA:** collaborative recording, replay, and browser-based validation.
- **Operations automation:** managed execution of repeatable business processes.

Choose a primary direction using:

- Workflow repetition and retention.
- Willingness to pay.
- Reliability and compliance requirements.
- Collaboration demand.
- Customer-acquisition difficulty.
- Execution cost and margin.
- Strength of existing alternatives.

This is a product decision gate, not a commitment to build all three products.

## Cross-Cutting Engineering Track

The architecture refactor in [Refactor_plan.md](../../Refactor_plan.md) supports every roadmap phase and should be delivered incrementally alongside product work. Its priorities are explicit session state, type-safe workflow editing, smaller UI and runtime boundaries, decomposed replay policies, typed injected recorder code, and tests aligned with feature ownership.

Architecture work should unblock or reduce the risk of a roadmap deliverable. It should not delay user outcomes solely to reach an idealized internal design.

## Sequencing Principles

1. Finish profile parameterization before adding a general variable system.
2. Measure replay reliability before promising unattended automation.
3. Separate secrets from profiles before supporting credential-driven runs.
4. Add operational controls before schedules or public triggers.
5. Preserve compatibility for existing local workflow and profile files.
6. Revisit priorities when usage evidence contradicts this sequence.

## Explicitly Not Planned Yet

The roadmap does not currently commit to:

- Conditional branching, loops, or free-form expressions.
- Multi-tab workflow execution.
- AI locator repair.
- Team collaboration or remote profile sharing.
- A particular cloud deployment platform.
- A database or remote persistence provider.

These require evidence, a scoped product specification, and—when they change an expensive-to-reverse boundary—an ADR.
