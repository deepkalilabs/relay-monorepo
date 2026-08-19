# Relay Monorepo Refactor

- Status: Approved
- Decision: `apps/browser-recorder/docs/decisions/0024-normalize-monorepo-layout-and-agent-tooling.md`
- Delivery: Three merge-gated pull requests
- Behavior change: None from the structural refactor

## Objective

Make application, library, documentation, and agent-tooling ownership explicit without
changing Relay runtime behavior or public interfaces.

## Pull request 1: Agent and repository foundation

- Move repository-wide Codex, Git-hook, ADR-gate, and plan ownership out of
  `apps/browser-recorder/`.
- Make root `AGENTS.md` the shared policy and routing source.
- Remove tracked runtime task state and classify existing plans and handoffs.
- Add focused root tooling tests and commands.
- Verify Node type checking, automation tests, and changed recorder tests.

## Pull request 2: Normalize applications and packages

- Move deployable units to `apps/browser-recorder`, `apps/relay-api`, and
  `apps/automation-service-browserbase`.
- Move reusable automation libraries to `packages/automation-core` and
  `packages/automation-worker-browserbase`.
- Update paths, builds, Docker contexts, tests, navigation, and nested instructions.
- Preserve package names, exports, binaries, contracts, environment variables, and
  accepted ADR contents.

## Pull request 3: Consolidate Node installation and deployment

- Replace relative `file:` workspace dependencies with standard matching versions.
- Retain only the root Node lockfile.
- Install and build Node deployments from the root workspace.
- Add root verification commands and guard against nested Node lockfiles.
- Preserve the API `uv` environment.

## Delivery rules

- Create the next branch from updated `main` only after the previous pull request merges.
- Keep every commit focused, buildable, reviewed, and independently revertable.
- Never force-push, bypass hooks, merge, or rewrite history.
- Keep the untracked root `.env.example` outside every commit.
- Record the ADR review before each authorized push.

## Final acceptance

- Deployable applications live under `apps/`; reusable Node libraries live under
  `packages/`; repository tooling lives at root or under `tooling/`.
- Root-started Codex sessions load the shared project configuration.
- A clean checkout uses one Node lockfile and `npm ci` succeeds from the root.
- All Node, Python, contract, application-build, and Docker verification passes.
- The three pull requests are reviewed and merged by a human in order.
