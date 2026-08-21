# Feature Spec: Browserbase Proxy Selection

- Status: Approved
- Requested: 2026-08-21
- Last updated: 2026-08-21

## Objective

Let a user opt into Browserbase's managed proxy when starting an interactive recording or
workflow replay instead of forcing every session through the proxy.

## User Experience

- The browser header shows a native **Use proxy** checkbox beside the existing session
  controls.
- The checkbox is unchecked by default so ordinary sessions use direct Browserbase
  networking.
- The checkbox remains keyboard accessible and exposes explanatory help text.
- The selection is editable before a session starts and disabled while a recording,
  replay, or session preparation is active because Browserbase networking cannot change
  after session creation.
- A restart or replay uses the currently selected value.

## Contract and Data Flow

The recorder client includes a required `useProxy` boolean on `session.start`,
`session.restart`, and `replay.start`. The Node WebSocket boundary validates the boolean
and passes it to `RecordingRuntime`, which forwards it as `BrowserSessionOptions.useProxy`.
`BrowserbaseProvider` maps the value directly to the SDK's `proxies` session option.

The choice is local UI state. It is not written to workflows, profiles, URLs, local
storage, or run evidence.

## Testing Strategy

- Protocol tests reject start commands without `useProxy`.
- Recorder hook tests prove the initial value is false and the selected value is sent for
  recording and replay.
- Browserbase provider tests prove both direct and proxied session creation.
- Component tests prove the checkbox is labeled, keyboard-operable, and disabled during
  an active session.
- Recorder verification uses `npm run test:changed` from `apps/browser-recorder/`, plus
  focused tests during the red/green loop.

## Boundaries

- Always preserve Browserbase region, CAPTCHA, logging, recording, and timeout behavior.
- Never expose Browserbase credentials or persist the proxy choice in workflow data.
- Do not add proxy geolocation or custom-proxy configuration in this increment.

## Success Criteria

- An unchecked checkbox creates a Browserbase session with `proxies: false`.
- A checked checkbox creates a Browserbase session with `proxies: true`.
- The setting cannot misleadingly change while the current session is running.
- Recording and replay paths use the same selected value.
