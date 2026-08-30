# Security incident response

This runbook covers Huddle credentials, Yahoo/OAuth data, provider evidence, league state, and screenshots.

## Immediate response

1. Stop the affected Huddle instance and preserve application/security logs without copying provider payloads into tickets.
2. Revoke the affected Yahoo OAuth connection and rotate the Yahoo client secret, token-encryption key, OpenRouter key, FantasyPros key, and Tank01 key as applicable.
3. Identify affected leagues, users, time range, data types, and whether encrypted tokens or provider-derived material were accessed.
4. Isolate the affected league/container. Do not allow one league's incident to interrupt evidence preservation for another.
5. Notify the owner and legal/security contact immediately. Provider notification deadlines can be shorter than standard internal reporting; treat 48 hours as the outer operational target for Yahoo-related incidents.

## Investigation controls

- Use token fingerprints, credential references, request IDs, and timestamps in logs. Never log access tokens, refresh tokens, authorization codes, screenshots, or full Yahoo responses.
- Record who performed each containment and recovery action.
- Check `GET /api/yahoo/oauth/status`, fleet readiness, state-file integrity, and provider quota status after rotation.
- Run `npm run check` before restoring service.

## Recovery

1. Restore only from known-good application and configuration versions.
2. Reconnect each affected league independently through OAuth.
3. Re-verify Yahoo league/team identifiers and settings before marking the league verified.
4. Purge expired AI evidence and any data that is no longer authorized to be retained.
5. Document root cause, corrective actions, residual risk, and follow-up owner.

Huddle is recommendation-only. An incident response must not introduce a temporary path that submits draft picks, waiver claims, roster changes, or trades.
