# Hosted draft runtime contract

Status: implemented locally; hosted deployment validation remains pending. Do not replace the running Yahoo service until the deployment gates pass.

`scripts/hosted-draft-server.cjs` prepares one new session with `create CONFIG.json`. Save the returned session ID. A supervisor must subsequently run `resume CONFIG.json SESSION_ID`. Never rerun create as a restart policy. Existing state without a matching `hostedDraftIdentity` is rejected; this entry point does not automatically migrate previous mock state.

The configuration requires `schemaVersion: 1`, the complete `league` configuration with Yahoo league/team provenance, `draftSlot`, `rulesHash` (the project's canonical digest of that complete league configuration), absolute `stateFile` and `playerPoolFile` paths, and the intended `host` and `port`. Paths must refer to durable storage. Configuration and state must be backed up before a separately authorized migration.

Resume checks the persisted session, league, team, seat, rules, identity schema, audit integrity and contiguous board. Completed sessions are served without starting collection. No Yahoo player-selection write is performed by this service.

Only one worker may own the state. Ownership uses an exclusive loopback socket derived from the canonical state path. All workers sharing the state must share the same host network and exact path; isolated container networks are not supported by this lease. A port collision refuses startup. Process death releases ownership. Host shutdown remains service unavailability.

Deployment must include package.json, package-lock.json, src, public, required scripts/configuration and generated clock assets. Install pinned dependencies with the lockfile, build clock assets, and compare source checksums before launch. Generated assets must be packaged separately from source rather than placed into a tool response that can truncate. Production credentials are supplied through the established environment/token store; checks may report presence, never values. A reproducible deployment package and boolean secret preflight are still required before hosted admission.

The supervisor must bound restarts and retain exit status, restart count and startup errors. The local process test exercises this entry point with a simulated read-only Yahoo response, then kills and resumes it. It does not establish actual hosted recovery, editor-independent uptime or Yahoo source timing.

The report download uses the existing decision-audit route with `?download=1`. It returns a durable JSON bundle containing a readable Markdown report, CSV, JSON evidence and SHA-256 checksums. Timing and selector attribution remain unknown without supporting evidence. This does not bypass an Edge policy block; that browser configuration still needs diagnosis and successful download validation.
