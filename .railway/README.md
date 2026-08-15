# Railway configuration

This project defines its Railway infrastructure in code.

```txt
.railway/railway.ts
```

Use this file to describe the Railway project you want: services, databases, buckets, custom domains, replicas, groups, and environment variables.

## Common commands

This monorepo intentionally has no root package manifest. Install both the current CLI
and the TypeScript IaC runner globally, then expose global modules to the runner:

```bash
npm install --global @railway/cli railway
export NODE_PATH="$(npm root --global)"
export RAILWAY_IAC_TS_BIN="$(npm prefix --global)/bin/railway-iac-ts"
```

Link specifically to `shimmering-hope` and `development`, then import before editing:

```bash
railway link --project 390725ff-1cf1-4a22-bd19-b4fab2dec4e0 --environment development
railway config pull --force
```

Preview what Railway would change:

```bash
railway config plan
```

Apply the planned changes:

```bash
railway config apply
```

## Notes

- `railway config plan` is safe and does not change Railway.
- The configuration rejects environments other than `development`.
- `railway config apply` previews changes and asks before applying unless you pass `--yes`.
- Destructive changes in non-interactive or agent sessions require `railway config apply --confirm-destructive` after reviewing the plan.
- Services already managed by `railway.json` or `railway.toml` must be migrated before `.railway/railway.ts` can manage them.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Secrets imported from Railway are rendered as `preserve()` so existing values are retained without writing secret values to source. Use `railway config pull --omit-preserved-variables` for a smaller import.
