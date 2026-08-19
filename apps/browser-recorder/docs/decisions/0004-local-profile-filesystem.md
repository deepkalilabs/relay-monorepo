# ADR 0004: Store profiles as local JSON files

- Status: Accepted
- Date: 2026-07-28

## Context

The Profiles screen displayed static identity, location, and browser examples. Profiles need local CRUD persistence without adding authentication, a database, or a remote service. The values include personal information, and future storage implementations should not require changes to the client feature or HTTP behavior.

## Decision

Define a server-side `ProfileRepository` port and use a filesystem implementation for v1. Store each profile as a schema `1.0` JSON file named `{profileId}.json` under `.data/profiles`, or under `PROFILE_DATA_DIR` when configured.

The custom server exposes list, create, get, save, and delete endpoints. List responses contain only profile name, lifecycle status, and update time; full identity details are returned only when a specific profile is loaded. Creation begins on the first explicit Save. Subsequent saves and permanent deletion require the last loaded revision.

Writes use private permissions and same-directory atomic replacement. The adapter serializes writes per profile ID inside the process, validates file contents and filename agreement, and skips invalid canonical files while returning a non-sensitive warning count.

Profile status is server-derived. A profile is Ready only when every field is populated and its email is syntactically valid; incomplete profiles remain persistable drafts.

## Consequences

- A future remote adapter can implement `ProfileRepository` without changing the profile UI contract.
- Local JSON contains identity information and must be protected accordingly.
- Revision checks prevent silent stale saves and deletions, but there is no cross-process lock or multi-user editing model.
- External file changes appear after refresh; no watcher or autosave queue is added.
- Browser and operating-system values are descriptive only and do not configure workflow execution.
