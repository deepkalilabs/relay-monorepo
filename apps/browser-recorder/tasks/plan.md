# Browserbase Proxy Selection Plan

## Increment 1: Contract and provider

Add required proxy intent to recorder start messages and Browserbase session options.
Prove direct and proxied SDK requests with focused protocol/provider tests.

## Increment 2: Recorder state and UI

Add ephemeral proxy selection to the recorder session hook and an accessible checkbox to
the browser header. Prove default, toggle, disabled, recording, and replay behavior with
hook and component tests.

## Increment 3: Integration and verification

Route validated values through the WebSocket server, run recorder verification, inspect
the interface in a real local browser, and review the final diff.
