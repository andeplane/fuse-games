# Developer insights production activation

Activation authorized by the owner on 2026-11-15 after reports returned HTTP 503. PR #699 was merged, but production had no `TELEMETRY_ENABLED` setting,
private media bucket or transcription delivery resources. The frontend was
therefore calling a deliberately disabled backend extension.

## Resource inventory

All resources belong to project `andershaf-87`. The existing gateway and named
Firestore database remain in `europe-west1`; the default database is untouched.

| Resource              | Configuration                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private media         | `gs://andershaf-87-fuse-insights`, uniform bucket IAM, public access prevention enforced                                                                        |
| Media deletion        | Delete objects after 30 days; soft delete disabled; API expiry is independently enforced                                                                        |
| Runtime object access | `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`: object creator and viewer on this bucket                                                            |
| Finalization topic    | `fuse-playtest-transcription`, separate from room signalling                                                                                                    |
| Notification          | Bucket notification `4`: `OBJECT_FINALIZE`, `recordings/` prefix, JSON payload                                                                                  |
| Worker subscription   | `fuse-playtest-transcription-worker`, no inactivity expiry, 600-second acknowledgement deadline                                                                 |
| Retry policy          | 10–600 seconds; dead-letter forwarding after approximately 20 attempts                                                                                          |
| Dead letters          | Topic `fuse-playtest-transcription-deadletter`; subscription `fuse-playtest-transcription-deadletter-review`, seven-day message retention, no inactivity expiry |
| Push identity         | `fuse-transcription-push@andershaf-87.iam.gserviceaccount.com`                                                                                                  |
| Push endpoint         | `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app/api/internal/transcription`                                                                                |
| OIDC audience         | `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`                                                                                                           |
| OpenAI secret         | `fuse-openai-api-key:1`, initialized from the existing repository secret by the guarded deployment                                                              |
| Quota HMAC secret     | `fuse-telemetry-rate-limit-key:1`, generated during authorized setup                                                                                            |

The Storage service agent publishes only to the dedicated finalization topic.
The Pub/Sub service agent can mint the push identity's OIDC token and forward
dead letters. The push identity can invoke Cloud Run; the application additionally
requires its exact verified email and audience on the worker route. This does
not grant developer access or permission to create recordings.

Delivery currently shares the gateway's global limit of two instances with
80 concurrent requests each. There is no separate per-worker concurrency limit;
watch gateway latency and queue age together if recording usage grows.

The report-range composite index is READY. The nine telemetry collection groups
in `firestore.indexes.json` have ACTIVE `cleanupAt` TTL policies. Default bucket
object access for project viewers/editors was removed. Application reads of
recordings, transcripts, actions and screenshots still require the code-owned
developer allowlist.

## Operations

Use an explicitly authorized account when operating GCP; do not change the
machine's active account to deploy this project. The activation operator used
`--account=andershaf@gmail.com`.

Repository variables supply the bucket, OIDC audience, push identity and model
names. Enable `TELEMETRY_ENABLED=1` only after those dependencies and secret IAM
are configured. Dispatch `Deploy backend` on main to apply configuration through
the exact-source verification gate. A repository variable change alone does not
change the running service. An already running deployment may have captured old
variable values; verify the final ready revision after the enabled run completes.

Inspect delivery metadata without dumping private payloads:

```sh
gcloud pubsub subscriptions describe fuse-playtest-transcription-worker \
  --project=andershaf-87 --account=andershaf@gmail.com
gcloud pubsub subscriptions describe fuse-playtest-transcription-deadletter-review \
  --project=andershaf-87 --account=andershaf@gmail.com
```

Use `/dev` for private reports, recordings and action proposals. Agent access
continues to use scoped action tokens documented in
[developer insights operations](../developer-insights.md); it does not grant
audio or transcript access. Do not paste secret values, raw user recordings or
unredacted production payloads into issues or CI logs.

## Activation verification

The full instrumented unit run at `90109d9b` passed 6,517 tests with one skip.
All eight browser coverage flows passed after repairing obsolete Ball Bros
admission expectations and waiting for Hook Havok's native menu-close handler.
Graveyard's updated flow and the 19 shared room-layout tests ran against `a81ec6d`.
Typecheck and build passed at both source revisions; the Elasto focus fix in
`6bf58fac` additionally passed its own full unit run, Chrome/WebKit regression and
hosted `verify` gate.

**Overall coverage remains below the repository threshold.** The combined
source-checked report for `6bf58fac` reports 94.48% lines/statements (95% required),
95.61% functions and 94.60% branches. Old coverage was reused only for files whose
source hash matched the current revision; changed covered files received fresh
coverage. The original failed report and browser failures remain preserved.
No threshold or exclusion was changed to make activation pass.

The largest uncovered included files are Fusemania's lab/timing UI, Fuse Front's
3D field renderer and Riders' voice-chat UI. The playtest modules also have
coverage gaps. This is an unresolved coverage failure on main, not a green full
release-suite claim. Activation changes the configuration of the existing
backend; it does not resolve those coverage gaps.

Production activation was first verified on `46f179ff`. The subsequent
[successful backend rollout](https://github.com/andeplane/fuse-games/actions/runs/43664670036)
serves `f1afd8345d08b2cd191e05307379ffd8d95a1c3b`, revision
`fuse-riders-gateway-00345-6ww`, with 100% traffic. Its immutable image digest is
`sha256:b697c1e005aee96402e012d06617fdb4917b2dbb719cff14f42e67e0f5ee8b7f`.
The live service has `TELEMETRY_ENABLED=1`, both pinned secret version references,
and the bucket, audience, identity and model settings above. Temporary deployer
secret administration and project-wide secret discovery grants were removed;
future deployments have metadata-viewer access on the two pinned secrets, while
the runtime has secret-accessor access.

Live checks on 2026-11-15:

- A real headless-browser report submission displayed **Report saved. Thank
  you.** Its metadata and 100,585-byte screenshot were durably stored; anonymous
  access to the private screenshot returned HTTP 403.
- Two synthetic PCM WAV chunks, 5,059 ms Norwegian and 3,468 ms English, reached
  the authenticated worker through real GCS finalization and Pub/Sub delivery.
  OpenAI transcribed both correctly, and the worker saved two proposed tasks
  with exact directive quotes and matching audio offsets. The producer process
  had exited before completion. This tests durable server processing, not a
  browser's last unfinished microphone chunk.
- A duplicate finalization message was published; the stored attempts remained
  one per segment, with the same two action records on the subsequent read.
- Unauthenticated recording creation, developer reads and worker requests
  returned 401; an invalid developer token returned 403. `/dev` rendered the
  Google sign-in gate.
- Synthetic audio, actions and the verification report/screenshot were removed
  after verification. The user's failed bug report text was preserved privately.
- On `46f179ff`, the shared top-bar tests passed 10/10 and the native recording-menu
  integration passed desktop/child toggling and rejected unrelated frame messages.

Actual microphone capture, live Google sign-in by each allowlisted developer,
Norwegian dialect/code-switch quality and physical-device behavior remain human
acceptance checks. No user microphone was recorded during activation.
