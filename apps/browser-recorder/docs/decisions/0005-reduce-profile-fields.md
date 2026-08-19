# ADR 0005: Limit profiles to identity and location fields

- Status: Accepted
- Date: 2026-07-28
- Supersedes: The browser-field portion of ADR 0004

## Context

ADR 0004 included descriptive browser and operating-system values in local profiles, while explicitly deferring any connection between those values and Browserbase or workflow execution. The Profile screen also retained a disabled Run control. These elements imply behavior the product does not support and add persistence fields without a current consumer.

## Decision

Remove browser name and operating system from the canonical profile contract, JSON files, HTTP payloads, form, and Ready-state calculation. Remove the disabled profile Run control and its footer.

New writes use profile schema `1.1`. The filesystem boundary continues to read schema `1.0` profiles, discards their legacy browser object, recalculates Draft/Ready status from identity and location fields, and exposes the normalized `1.1` profile. A subsequent save writes the canonical reduced shape.

## Consequences

- Profiles communicate their current purpose: reusable identity and location values.
- Existing local schema `1.0` files remain readable without retaining unused browser metadata.
- Ready requires profile name, full name, valid email, country/region, and postal code.
- Browser configuration and profile-driven workflow execution require a future explicit product and contract decision.
