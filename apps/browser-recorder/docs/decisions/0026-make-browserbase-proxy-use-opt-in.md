# ADR 0026: Make Browserbase proxy use opt-in

- Status: Accepted
- Date: 2026-08-21

## Context

Interactive recorder sessions always requested Browserbase's managed residential proxy.
That added network latency and proxy bandwidth even when the target site did not require
proxy routing. Users need to choose the higher-latency network mode when it is useful
without creating a second recording workflow or server configuration.

## Decision

Make Browserbase proxy use an explicit, unchecked-by-default session choice in the
recorder browser header. Carry the required boolean on recording, restart, and replay
start messages, validate it at the WebSocket boundary, and map it directly to the
Browserbase session `proxies` option.

Keep the choice ephemeral and client-local. Do not persist it in workflows or profiles,
and do not expose provider credentials or custom proxy configuration. Lock the control
after session creation because Browserbase network routing is fixed for the lifetime of
that session.

## Alternatives considered

- Keep proxies always enabled. Rejected because it retains avoidable latency and proxy
  bandwidth for ordinary recordings.
- Disable proxies globally through an environment variable. Rejected because different
  targets have different bot-protection and routing requirements within the same server.
- Persist the choice per workflow. Rejected because proxy routing is a run-time execution
  concern and would expand the workflow contract unnecessarily.

## Consequences

- Direct Browserbase networking becomes the default for new recordings and replays.
- Users can opt into Browserbase's managed proxy before starting a session.
- Recorder start messages gain a required field and are intentionally incompatible with
  older clients that do not declare their network choice.
- Existing region, CAPTCHA, recording, logging, and timeout settings remain unchanged.
