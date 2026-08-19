# Browser Memory Recorder

Browser Memory Recorder turns a live browser session into an editable, locally saved automation blueprint. Use an embedded Browserbase browser normally, and the app records completed field edits, native dropdown selections, and semantic button clicks as structured workflow steps.

Each step can be reviewed, renamed, reordered, disabled, or deleted before the workflow is saved or exported as validated, versioned JSON. Saved workflows appear in the Library and can be reopened or replayed later.

## What it does

- Opens an interactive cloud browser through Browserbase Live View.
- Records browser activity as semantic actions rather than raw mouse coordinates.
- Builds ordered locator candidates from roles, labels, text, CSS, and XPath.
- Displays recorded actions immediately in an editable workflow timeline.
- Adds manual assertions by selecting an element in the live browser.
- Creates durable drafts and saves one JSON file per workflow.
- Lists locally saved drafts and completed workflows in the Library.
- Creates, edits, and permanently deletes reusable local profiles backed by one JSON file each.
- Supports reconnecting to an active recording after a short network interruption.
- Exports the completed workflow as portable JSON.
- Replays full workflows or starts from a selected deterministic step.
- Returns to recording after replay so workflows can be built and verified incrementally.
- Waits for DOM and network activity to settle between replayed actions, with optional per-step delay and element conditions.
- Pauses on failures with Retry, Skip, Take Control, and Stop recovery actions.
- Checks element visibility or normalized text containment without changing the page.

The current product foundation focuses on accurate capture, explicit local saving, review, interactive replay, and reusable local profiles. There is no autosave: leaving the editor discards changes made since the last successful Save. The active product direction is maintained in the [product roadmap](./docs/product/roadmap.md).

## How it works

```text
User interacts with Browserbase Live View
                    │
                    ▼
Injected recorder observes browser events
                    │
                    ▼
Playwright runtime normalizes and deduplicates actions
                    │
                    ▼
WebSocket sends semantic steps to the React workspace
                    │
                    ▼
User explicitly saves through the local workflow API
                    │
                    ▼
Atomic JSON file in .data/workflows
```

The React client owns unsaved edits while the editor is open. Route-private workspace modules under the workflow editor route compose the browser, recorder, replay, and workflow features through their public entry points. A custom Node server keeps Browserbase credentials out of the client, exposes the local workflow API, maintains the Playwright CDP connection, and streams sequenced recorder events over `/ws`.

## Repository structure

```text
browser_replay/
├── docs/
│   └── product/
│       ├── roadmap.md             # Active product direction and sequencing
│       └── mvp_design.md          # Historical MVP product specification
├── src/
│   ├── app/
│   │   ├── (product)/             # Product routes; group is omitted from URLs
│   │   │   ├── library/           # Local workflow Library route
│   │   │   ├── profile/           # Local profile library route
│   │   │   └── workflows/[workflowId]/edit/
│   │   │       ├── _components/   # Route-private workspace composition
│   │   │       └── _hooks/        # Route-private workspace policy
│   │   ├── (test-support)/fixture/ # Controlled pages used by E2E tests
│   │   ├── _styles/               # Global tokens, reset, and shared controls
│   │   └── layout.tsx             # Single Next.js root layout
│   ├── features/
│   │   ├── browser/               # Live View, overlays, hooks, and browser model
│   │   ├── recorder/              # Recorder components, model, and transport
│   │   ├── replay/                # Replay controls, recovery, and run dialog
│   │   ├── workflow-editor/       # Timeline, editing state, API, and export
│   │   ├── workflow-library/      # Saved-workflow library presentation
│   │   └── profile/               # Profile CRUD presentation and HTTP client
│   ├── shared/
│   │   ├── contracts/             # Profile, workflow, recording, and protocol contracts
│   │   └── ui/                    # Shared accessible UI primitives
│   └── server/
│       ├── infrastructure/browser/ # Browserbase adapter and provider port
│       ├── recording/
│       │   ├── deduplicate.ts     # Duplicate event suppression
│       │   ├── injected.ts        # Script installed in browser pages
│       │   └── runtime.ts         # Session, page, and event runtime
│       ├── replay/                # Replay engine and replay policies
│       ├── profiles/              # Profile filesystem repository and local HTTP API
│       └── workflows/             # Workflow filesystem repository and local HTTP API
├── tests/
│   ├── e2e/                       # Playwright workspace and browser tests
│   ├── components.test.tsx        # React component behavior
│   ├── recorder.test.ts           # Recorder normalization tests
│   └── workflow.test.ts           # Workflow store and schema tests
├── server.ts                      # Next.js HTTP and WebSocket server
├── plan.md                        # Architecture and delivery boundaries
├── master_design.md               # Extended design document
└── package.json                   # Commands and dependencies
```

Each feature exposes a small `index.ts` API. Route-private application composition may import those APIs, while feature internals use relative imports. Shared contracts are client/server-safe and do not depend on features. ESLint prevents deep cross-feature imports, lower layers from importing `app`, and client modules from importing server implementations.

## Workflow model

The dependency-free workflow domain and validation contract lives in the root
`@relay/workflow-contract` package. Compatibility re-exports under
`src/shared/contracts/workflow` keep frontend imports stable while serialization,
parameter resolution, and library projections remain frontend-owned. Client/server
message schemas are split by direction under `src/shared/contracts/protocol`.

Saved workflows and new exports use schema version `1.4`, including `status`,
`revision`, optional `finishedAt` lifecycle fields, explicit input bindings on `fill`
steps, and element and repeated-group assertions. Supported schema `1.0` through `1.3`
documents normalize in memory to `1.4`; loading alone never rewrites a stored file. A
workflow also contains its Browserbase source, timestamps, and an ordered list of steps.
Automatic recording produces `fill`, `set_date`, `select`, `click`, and Enter
`keypress` steps. Manual action steps and existing workflows continue to support:

```text
navigate · click · fill · select · check · uncheck · keypress · submit
```

`ElementTarget` keeps multiple locator candidates, ordered from semantic selectors to CSS and XPath fallbacks, rather than coupling replay to one selector. Metadata records whether a step was recorded or manually added, and whether its value may be sensitive.

Assertions are manually authored and remain outside the recorded-action contract. A live-session picker captures the selected element's locator evidence and page context without activating the website or recording the selection click. Replay evaluates the assertion once: `visible` requires one visible match, while `text_contains` compares trimmed, whitespace-collapsed, case-insensitive visible text. Assertions do not define post-step waits.

Action steps may also define an optional replay wait. A wait can add up to 30 seconds after an action and can require an element to remain visible or hidden before replay continues.

The Library can bind each enabled `fill` step to its recorded value, a fixed literal, a supported profile field, or a value requested at run time. Profile and run-time values are resolved into an ephemeral workflow before replay and are not written back to workflow files.

## Local workflow storage

The server stores each workflow as `.data/workflows/{workflowId}.json`. Writes use a same-directory temporary file followed by an atomic rename, and every explicit save checks the last loaded revision. If another save wins first, the editor keeps the local edits visible and offers to reload the saved version.

Set `WORKFLOW_DATA_DIR` to use another absolute or project-relative directory:

```bash
WORKFLOW_DATA_DIR=/path/to/workflows npm run dev
```

The Library API returns workflow names and ordered step names only. Full step payloads are loaded only when an editor route opens a specific workflow. Invalid files are skipped while valid workflows remain available.

## Local profile storage

Profiles are explicitly saved as `.data/profiles/{profileId}.json`. The first Save creates the file; later saves and permanent deletion require the last loaded revision so stale clients cannot silently replace or remove newer data. Writes use private permissions and same-directory atomic replacement.

Set `PROFILE_DATA_DIR` to use another absolute or project-relative directory:

```bash
PROFILE_DATA_DIR=/path/to/profiles npm run dev
```

The profile list API returns only names, Draft/Ready status, and update times. Identity and location values are loaded only for the selected profile. Incomplete profiles remain persistable drafts; Ready status is derived only when every field is present and the email is valid. Invalid files are skipped and surfaced as a non-sensitive count.

## Workflow workspaces

At first launch, the app asks where workflows should be loaded and saved. Development
offers local files plus every namespace returned by Relay and defaults to Local. Production
offers Relay namespaces only. The confirmed choice is remembered in the browser and can be
changed from the product sidebar. Profiles remain in the local profile repository.

Configure Relay namespace discovery and namespace-scoped workflow persistence with:

```bash
RELAY_API_BASE_URL=https://relay.example.com/ \
RELAY_API_USERNAME=server-user \
RELAY_API_PASSWORD=server-secret \
npm run dev
```

The remote service must implement namespace listing and the namespace-scoped operations in
the versioned [workflow](./docs/specs/cloud-workflow-api.openapi.yaml) contract. The adapter
sends HTTP Basic credentials only from the Node server, validates all remote responses, and
retries one transient failure with the same idempotency key. Profiles remain in the local
filesystem repository. This repository does not implement the remote service or its database.

The same three Relay variables enable background folder runs through the public
`/v1/batches` and `/v1/artifacts` routes. Batch creation is attempted exactly once; polling
and terminal screenshots are proxied through Browser Replay so Relay credentials never need
to be configured separately.

## Requirements

- Node.js 24 LTS (`nvm use` reads `.nvmrc`)
- npm
- A Browserbase account and API key

## Setup

Install dependencies once from the repository root, then configure and start the
recorder through its workspace:

```bash
npm ci
cp apps/browser-recorder/.env.example apps/browser-recorder/.env.local
npm run dev --workspace browser-memory-recorder
```

Add `BROWSERBASE_API_KEY` to `apps/browser-recorder/.env.local`, then open
[http://127.0.0.1:3000](http://127.0.0.1:3000).

For local development, `npm run dev` also loads an existing, gitignored `secret.txt` containing `BROWSERBASE_API_KEY=...`. This keeps the key out of tracked files and takes precedence over the empty `.env.local` template.

`BROWSERBASE_PROJECT_ID` is optional because Browserbase can infer it from the key. The custom server serves both Next.js and `/ws`, so use the workspace `dev` script instead of `next dev`.

### Railpack deployment

Use the repository root as the build context and set
`RAILPACK_CONFIG_FILE=apps/browser-recorder/railpack.json`. The tracked configuration
uses the root lockfile, builds only `@relay/workflow-contract`, `@relay/replay-core`, and
the recorder workspace, then starts the existing production server script.

## Commands

Run these scripts from `apps/browser-recorder/` after the root install, or append
`--workspace browser-memory-recorder` when running them from the repository root.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js and the recorder WebSocket in watch mode |
| `npm run build` | Create a production Next.js build |
| `npm start` | Run the production custom server |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm test` | Run the Vitest unit and component suite |
| `npm run test:changed` | Run tests affected by staged, unstaged, or untracked changes |
| `npm run test:e2e` | Run local Playwright end-to-end tests |
| `npm run test:browserbase` | Run the paid Browserbase smoke test |

Repository-wide agent commands, hooks, and the supervised Ralph loop run from the
repository root. See [`../../docs/README.md`](../../docs/README.md) and the root
[`README.md`](../../README.md).

## Security and session lifecycle

- Browserbase credentials remain in the local server environment.
- All entered values are captured, including passwords, tokens, and payment fields.
- Sensitive steps are marked but are not automatically redacted.
- Recorded payloads are written to local workflow JSON only after Save or Finish and are never written to server logs.
- Local workflow files can contain passwords, tokens, and payment values in plain text; protect the workflow data directory like other secrets.
- Local profile files contain identity and location information in plain text; protect the profile data directory like other personal data.
- Exported JSON is plain text and should be handled like a secret.
- Assertion expected text and observed mismatch text remain plain in workflow files, exports, the UI, and diagnostics. Do not create assertions from secrets or other sensitive page content.
- Automatic CAPTCHA solving is enabled for recording and replay sessions. During recording, detected challenges temporarily lock local browser input while Browserbase solves them; replay remains unchanged and CAPTCHA lifecycle events stay available in server diagnostics.
- Sessions are released on Stop, disconnect timeout, replacement, or server shutdown.
- The default Browserbase session timeout is 30 minutes and may incur usage charges.

This app is intended for local development or long-running Node hosting. The persistent WebSocket and Playwright connections used by recording and replay make it unsuitable for serverless deployment.

## Current product boundaries

The product supports a single active tab, with an explicit prompt when a popup opens. It is a desktop workspace intended for viewports at least 1024 pixels wide.

Replay remains linear and single-tab. Assertions are limited to element visibility and normalized text containment. Authentication, variables, persisted failure evidence, secret management, unattended execution, collaboration, and production deployment are not part of the current foundation. Profiles currently store identity and location values only.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The E2E suite uses controlled pages under `/fixture` and includes an accessibility scan. The Browserbase smoke test requires a real API key and creates a paid remote session:

```bash
BROWSERBASE_API_KEY=... npm run test:browserbase
```

For current product direction, see [docs/product/roadmap.md](./docs/product/roadmap.md).
For implementation and architecture context, see the archived
[profile-parameterization plan](../../docs/plans/archive/browser-recorder-profile-parameterization.md),
[Refactor_plan.md](./Refactor_plan.md), and the historical
[docs/product/mvp_design.md](./docs/product/mvp_design.md).
