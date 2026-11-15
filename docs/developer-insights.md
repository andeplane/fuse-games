# Developer insights operations

The developer workspace is `/dev/` (production target
`https://fusegames.ai/dev/`). This document describes the implementation and
release setup, not evidence that the endpoint is deployed. The current design
and schema rationale are in [design/developer-insights.md](design/developer-insights.md).

## Access and privacy

Sign in with Google. The server validates the signed Google identity, verified
email and code-owned allowlist in
`packages/fuse-telemetry/src/developer-access.ts`: `andershaf@gmail.com`,
`andersullnass@gmail.com`,
`andreas@bonito.no`, `andreassolbra@gmail.com`, `aasmund.eldhuset@gmail.com`,
`richard.rormark@gmail.com`, `sindre@scrimba.com`.

Only these admins can create recordings or upload audio. After server-verified
sign-in, the shared game menu offers Start recording / Stop recording without
a URL flag. Starting explicitly requests microphone permission; signing out
stops capture. FuseOS owns a single microphone recording across embedded games,
including when their menus control it. `?record` and its `?report` alias remain
optional shortcuts to the opt-in recording UI; neither grants authorization.
Ctrl+X reporting remains available without audio or admin sign-in. Reports
associated with a recording require its authenticated owner. Screenshots,
reports, audio, transcripts and extracted actions are private. Keep them out
of public issues, PR descriptions, screenshots, logs and fixtures. Link private
entry IDs and use a minimal redacted reproduction when reporting a bug.

### Capabilities, audit and access review

The code-owned email allowlist remains the outer identity gate. A durable policy
per Firebase UID then grants `read` (private reports, recordings, transcripts,
media and metrics), `record` (create, upload and finish owned recordings), and
`token` (mint/revoke agent credentials and mutate proposed actions). A UID with
no policy has no capabilities, even when its email is allowlisted. This prevents
a recreated Firebase account from silently inheriting a revoked person's access.
An explicit empty policy also denies all developer access. A valid Google ID token
must have an `auth_time` within 15 minutes to start a recording or mint a token.
The workspace and recording panel offer Google reauthentication; refreshing an
ID token alone does not change `auth_time`. Ongoing uploads and finishing do not
require a fresh sign-in, but still require the record capability and ownership.

Every developer private-route attempt is appended before a response or mutation
to `${prefix}-developer-audit`, with verified UID, verified email, server time,
operation and resource ID/path; list responses also log the returned report or
recording IDs. Minted credential IDs are logged before disclosure. The log stores
neither bearer tokens, query strings, reports nor transcripts. A failed audit
write fails the private request closed. These are attempts, not proof a mutation
succeeded. The service only creates audit documents; this is application-level
append-only behavior, not protection against an IAM principal able to modify
Firestore directly. Restrict IAM and configure independent Cloud Audit Logs,
retention and alerts; this change does not configure them. Local development
uses `.fuse-insights/security/audit.jsonl` and an atomic policy file.

The service owner (Anders) reviews the allowlist and UID policies monthly and
after departures or suspected compromise. Record the date, reviewer, every
person's purpose and minimum capabilities, and removals in a private access
review record. Do not put private UID/email inventories in public issues. Use
the production GCP project, named Firestore database and deployment's prefix, with authorized
Application Default Credentials, to inspect or change one UID without a deploy:

```sh
pnpm exec tsx scripts/developer-access.ts show PROJECT DATABASE PREFIX UID
pnpm exec tsx scripts/developer-access.ts set PROJECT DATABASE PREFIX UID read,record
pnpm exec tsx scripts/developer-access.ts revoke PROJECT DATABASE PREFIX UID
```

**Before deploying this access change**, the owner must inventory the Firebase
Authentication users in the intended project, verify each person's UID and
verified allowlisted email through the Firebase console or authorized Admin SDK,
decide their minimum capabilities, and run `set` for each approved UID using
the actual production database and prefix. Review each result with `show` and
record the review privately. Until these policies are created, all developer
workspace access and recording requests are denied after rollout; do not assume
the email allowlist bootstraps them. A newly created or recreated UID likewise
requires explicit review and a grant, even when it has the same email as a revoked
UID. Do not grant a replacement UID merely because the address matches. After a
grant, the person must sign in again. Existing agent credentials must be reminted.
No bootstrap is performed by this change or by deployment.

`set` replaces the complete capability list; every change advances the UID's
generation and permanently invalidates credentials minted under older
generations, even if access is later restored. Recording sessions have a separate
generation that advances when recording access is removed: old sessions cannot
accept further uploads after that, even if access is restored; their unsent
browser chunks remain on the device and are not retried. An obsolete session
stops its microphone when the server rejects the next upload, without blocking
later sessions. Changes to other capabilities leave an
authorized recording running. Restoring a removed capability requires a Google
sign-in after it was restored. `revoke` installs an empty policy
first, blocking subsequent developer requests and agent-token verification,
then marks that owner's active recording records finished. The command may be
retried if the finishing scan fails; inspect its exit status. Already in-flight
requests may finish, and an offline browser cannot be remotely commanded to stop
its microphone; connected recording clients stop when a subsequent upload detects
the revoked access. Local queued chunks remain private on that browser. The
operator command records the target and attempted change in the same audit log,
but its actor is not verified by the application: use GCP's separately configured
IAM audit logs to identify the operator. Reinstatement requires an explicit
`set`, a fresh Google sign-in after the policy change, and rechecking the
code-owned allowlist. Agent credentials minted before this change lack the
verified email needed for attribution and must be replaced.
Firebase timestamps have one-second resolution; if confirmation occurs in the
same second as the policy change, wait a second and confirm sign-in again.

Prefer managed-domain accounts with enforced MFA for recording and token access.
This code verifies Firebase's Google provider and recent authentication only; it
does not establish a managed domain, require MFA, or prove an MFA challenge.
Those controls and their verification belong to the identity administrator.

Metrics use anonymous browser installation IDs and inactivity-based sessions,
not verified people. Weekly/monthly unique counts use membership sets rather
than summed daily totals. Round plays count participating browsers at actual
play, excluding spectators/countdowns. See [ANALYTICS.md](ANALYTICS.md).

## Analytics workspace

Overview, Raw Events and Player Sessions share UTC dates, an autocomplete game
textbox and OR-of-AND constraints. The textbox lists every registered game on
focus, including games without events, and narrows while typing. A clicked game,
player, song, event type or property adds an AND constraint to every OR group.
Sessions open the corresponding player/session event timeline. Existing Playtest
sessions are audio recordings, separate from these ordinary player visits.

Raw Events starts with common fields and discovers optional columns from the
current selection. `kind` identifies app, seat, match, round and custom events.
Queries read at most 2,001 source documents; each displayed slice contains at
most 2,000, with stable time/id continuation. An empty filtered slice may still
have older matches. Slice counts are labelled, overview lower bounds use `≥`,
incomplete charts are withheld, and DAU/MAU are withheld when their full history
cannot be read. DAU is the selected end date; MAU is that calendar month through
the end date. Both count distinct anonymous browsers and use the same filters.
Play totals require an explicit `played: true`: spectators/TV displays and
legacy observations with unknown participation remain in raw events and active
browser/session measures, but do not inflate round/match/game plays. The
overview discloses excluded legacy observations.

New lifecycle observations link reported participants by irreversible play
references derived from random shared-runtime UUIDs, including Birds' UUID/round
scope. Reusable local seed IDs are excluded. Correlation covers loaded source
events only; historical events without references cannot reconstruct other
participants. Names, emails and room capabilities remain excluded.

The workspace assistant uses `OPENAI_API_KEY`, server-side only, and the exact
`gpt-6.1-sol` model through Responses. It navigates sections, edits filters and
columns, opens sessions/recordings, reads the current screen, operates visible
controls and prepares issue drafts through the same browser command adapter as
the human. Credentials, sign-in/out and publishing require the human. Each
question has six steps and a bounded context. Server limits are 8 provider calls
per minute and 80 per day per admin, 400 per day globally, one durable in-flight
lease per admin, 1,800 output tokens and a 55-second provider timeout. Event
scanning separately reserves up to 2,001 reads per request against 400,000 per
admin/day and 2,000,000 globally/day. Normal admission, policy and audit checks
also apply. An unavailable provider or exhausted quota leaves the page usable.

Action Proposals offers Connect GitHub and an editable public-issue composer.
Enable GitHub in Firebase Authentication and configure its OAuth callback before
using this flow. GitHub links to the existing Firebase player; it does not
replace developer Google access. Connecting requires recent authentication and
the `token` capability. Access tokens are validated against GitHub, then
AES-256-GCM encrypted in `telemetry-github` under a UID-derived key with UID AAD.
The encryption key is domain-separated from `TELEMETRY_RATE_LIMIT_KEY`; rotating
that secret requires reconnection. Neither status nor logs expose the token.
Disconnect clears usable credentials. The local preview uses memory only.

Publishing targets `andeplane/fuse-games`, checks the proposal revision and
retraction state, and excludes private evidence from the default draft. Limits
are 10 publication/reconciliation requests per admin/day and 30 globally/day.
Each proposal revision has a durable idempotency marker. Explicit rejection is
retryable; uncertain outcomes reconcile before another POST can occur. If the
created issue falls outside the latest 100 results, enter its issue number in
the composer; the server verifies its marker before attaching it. No duplicate
is sent merely because a connection dropped.

New private endpoints: `GET /api/dev/catalog`, `POST /api/dev/events`,
`POST /api/dev/assistant`, `GET|POST|DELETE /api/dev/github` and
`POST /api/dev/github/issues`. Action-only agent credentials cannot use them.

## Local development

Run the normal `pnpm dev` flow and open the printed free-port URL with `?mute`.
Open `/dev/` on the same origin. The default local service persists reports,
attachments and action records in ignored `.fuse-insights/`; metrics reset
with the process. Local microphone recording stays disabled until a durable
production-equivalent upload/worker path is configured. A local preview does
not pretend to have transcribed speech or a live action queue. Unit tests
inject explicit fake transcription/extraction adapters.
To enable local private insights for an approved test UID, stop the local
service, run `pnpm exec tsx scripts/developer-access.ts set-local .fuse-insights/security UID read,record,token`,
then restart it and sign in again. `show-local` and `revoke-local` use the same
directory and UID arguments; local policy edits take effect on restart. Local
recording remains disabled regardless of this grant.

## Private HTTP API

Developer reads use `Authorization: Bearer <Google ID token>` and no-store
responses. Exact request/response definitions are in
`packages/fuse-telemetry/src/contracts.ts`, `debug-contracts.ts` and
`action-contracts.ts`; routes are implemented in their `*-http.ts` modules.

| Route                                                  | Request and result                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/telemetry/events`                           | Anonymous bounded event batch; preserves opt-out, DNT, local-dev guard and scrubbed properties.                                       |
| `GET /api/dev/me`                                      | Verified developer principal.                                                                                                         |
| `GET /api/dev/metrics`                                 | Required `period=day\|week\|month`, `from`, `to`; optional `gameId`; UTC period buckets.                                              |
| `POST /api/telemetry/reports`                          | JSON report with optional screenshot and recording context; returns persisted report acknowledgement.                                 |
| `POST /api/telemetry/recordings`                       | Admin-owned JSON recording metadata; returns `{recording}`; 503 when recording dependencies are unavailable.                          |
| `PUT /api/telemetry/recordings/:id/segments/:sequence` | Admin owner, independently playable PCM `audio/wav`, `X-Recording-Start-Ms`, optional `X-Recording-Game-Id`; durable acknowledgement. |
| `POST /api/telemetry/recordings/:id/finish`            | Admin owner finishes recording; returns `{recording}`.                                                                                |
| `GET /api/dev/reports`                                 | `limit`, opaque `cursor`, optional `recordingId`; paginated private reports.                                                          |
| `GET /api/dev/reports/:id`                             | `{report}`.                                                                                                                           |
| `GET /api/dev/reports/:id/screenshot`                  | Private image bytes, no-store; never a public bucket URL.                                                                             |
| `GET /api/dev/recordings`                              | `limit`, opaque `cursor`; paginated recordings.                                                                                       |
| `GET /api/dev/recordings/:id`                          | Recording detail, ordered segments, transcription states and related reports.                                                         |
| `GET /api/dev/recordings/:id/segments/:sequence/audio` | Private WAV bytes, no-store.                                                                                                          |
| `POST /api/internal/transcription`                     | Dedicated authenticated Pub/Sub push worker; Google OIDC audience and service-account checks, not developer/agent tokens.             |

Chunks use sample-based recording offsets; transcripts have chunk-level time
precision. Uploaded chunks survive browser closure after durable acknowledgement.
The uncommitted active audio buffer and queued/in-flight uploads are not yet
server-saved. Failed transcription/extraction stays visible and retryable.

## Agent action workflow

The admin mints an action-only token in `/dev/`, scoped to a game or recording.
It is shown once, stored hashed on the server and expires after one hour by
default (24 hours maximum). Set `FUSE_DEV_AGENT_TOKEN` privately in the agent
environment; never put it in argv, URLs, source or logs. Set
`FUSE_DEV_API_ORIGIN` to the service's HTTPS origin, with no path or query.
HTTP is accepted only for localhost/loopback development.

```sh
pnpm exec tsx scripts/dev-insights.ts list --gameId fuse-riders --status proposed
pnpm exec tsx scripts/dev-insights.ts list --recordingId RECORDING_ID --since EPOCH_MS
pnpm exec tsx scripts/dev-insights.ts claim ACTION_ID --agent codex
pnpm exec tsx scripts/dev-insights.ts renew ACTION_ID
pnpm exec tsx scripts/dev-insights.ts release ACTION_ID
pnpm exec tsx scripts/dev-insights.ts complete ACTION_ID --note 'PR #123; focused regression and browser flow verified'
```

Claim results print action metadata; the lease token is saved only in ignored
`.fuse-insights/claims/ACTION_ID.json` with mode 0600 (directory mode 0700).
Renew/release/complete read that file and refuse an API-origin mismatch. Renew
updates it; successful release/complete removes it. Errors preserve claims for
retry. A lost claim response or failed local save may leave a server lease
active; inspect the item and allow expiry before reclaiming. Protect the whole
directory as credential-bearing private state. Do not share its contents.

| Action API                           | Semantics                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/dev/actions`               | `gameId`, `recordingId`, `since` (inclusive `updatedAt` epoch ms), `status`, `cursor`, `limit`; returns `{actions,nextCursor?,scannedRecordings}`. |
| `POST /api/dev/actions/:id/claim`    | `{agentName,leaseMs?}` → `{action,token}`; atomic exclusive claim.                                                                                 |
| `POST /api/dev/actions/:id/renew`    | `{token,leaseMs?}` → `{action,token}`; same unexpired owner/secret required.                                                                       |
| `POST /api/dev/actions/:id/release`  | `{token}` → `ActionItem`; relinquishes lease.                                                                                                      |
| `POST /api/dev/actions/:id/complete` | `{token,note}` → `ActionItem`; nonempty note up to 1000 characters.                                                                                |
| `POST /api/dev/actions/:id/dismiss`  | Developer-only `{note}` → `ActionItem`.                                                                                                            |
| `POST /api/dev/agent-tokens`         | Developer-only `{gameId?,recordingId?,expiresInMs?}`; at least one scope; minted bearer shown once.                                                |
| `DELETE /api/dev/agent-tokens/:id`   | Developer-only revoke; `{revoked:true}`.                                                                                                           |

Agent tokens cannot create recordings, upload audio or read unrelated private
media. Lease duration defaults to five minutes; supported range is 10 seconds
through 30 minutes. Expired claims become available again. A 409 requires
re-reading the item, not assuming ownership. Auth expiry/revocation requires a
fresh admin-minted token.

Poll only when requested; the CLI does not launch agents, schedule polling,
execute tasks or merge/deploy. For incremental reads, drain every `nextCursor`
before advancing the `since` watermark, keeping the same filters for the scan.
An empty page can still have a cursor. Preserve the prior watermark until the
whole scan succeeds and deduplicate by item ID/revision; `since` is inclusive.
Re-scan with overlap so updates during a paginated scan are not lost.

Before claiming, read the verbatim quote, chunk timestamp and surrounding
context, reproduce the issue, check overlapping PRs/branches/issues and confirm
the spoken request was not corrected or retracted. Only explicit directives
authorize proposed work. Ideas, questions and extraction confidence do not.
After claiming, renew during work and re-read evidence/status regularly.
Retractions and corrections remain visible on claimed/completed items; renew
and completion reject a superseded claim, requiring review and release. Record
actual verification and a PR reference on completion. Queue ownership grants
no merge or deployment permission.

## Production dependencies and retention

Production activation was authorized on 2026-11-15. The private bucket and
authenticated delivery resources are provisioned; see
[the activation inventory](online/DEVELOPER-INSIGHTS-ACTIVATION.md) for exact
resource names, verification and remaining acceptance checks. A release requires:

- `TELEMETRY_ENABLED=1`, a private `TELEMETRY_BUCKET`, Firestore indexes from
  `firestore.indexes.json`, and the authenticated developer sign-in setup.
- `OPENAI_API_KEY` and `TELEMETRY_RATE_LIMIT_KEY` in Secret Manager, injected only
  into the server. `OPENAI_API_KEY` already exists as a GitHub repository secret;
  reuse it through the enabled deployment workflow without printing or asking
  for its value. Authorized bootstrap can copy it via stdin to Secret Manager
  and generate the server HMAC key automatically. Never use `VITE_` secrets.
- Pinned numeric Secret Manager versions through workflow variables
  `OPENAI_API_KEY_SECRET` and `TELEMETRY_RATE_LIMIT_KEY_SECRET` (`name:version`),
  consumed by `scripts/deploy-cloud.sh`. Avoid mutable `latest` references.
  When these overrides are absent, the guarded deployment calls
  `scripts/insights-secret-refs.sh` after its source-verification gate. It reuses
  the latest enabled numeric version of the managed secrets, bootstraps missing
  secrets from the repository key / fresh randomness, and grants the runtime
  service account access. The deployer needs secret discovery, creation, version
  and IAM-management permissions for this first setup. Explicit custom references
  require their accessor IAM to be set separately. Rotating the repository key
  does not silently rotate an existing managed secret: add a new Secret Manager
  version and select it deliberately.
- Private GCS object access for the runtime service account, Secret Manager
  accessor rights, and Firestore access. Keep bucket public access prevention
  enabled; readers fetch media through authenticated server routes.
- GCS `OBJECT_FINALIZE` notifications to a dedicated Pub/Sub topic/subscription,
  separate from room signalling. Authenticated push targets
  `/api/internal/transcription`. Configure `TRANSCRIPTION_PUSH_AUDIENCE` and
  `TRANSCRIPTION_PUSH_SERVICE_ACCOUNT` to match the signed OIDC token, authorize
  its minting/delivery and Cloud Run invocation, and restrict this identity to
  the worker path. No detached post-response processing on request-based CPU.
  Use a 600-second delivery acknowledgement deadline, bounded delivery concurrency
  and a dead-letter topic. A failed or missing predecessor transcript blocks
  subsequent action extraction until repaired; it does not silently turn later
  speech into tasks without its context. Review failed segments and dead letters.
- Raw events: 90 days. Audio/trusted screenshots: 30 days. Anonymous report text
  and screenshots expire after two days; screenshots use the separate
  `anonymous-screenshots/` prefix. Report text, transcripts,
  action records and metric aggregates: 365 days. Configure Firestore TTL and
  bucket lifecycle cleanup; server-side expiry checks must independently deny
  reads because background deletion is asynchronous. No Mixpanel history is
  migrated or deleted.

The shared Firestore transactions admit at most 100,000 metric events, 500
reports and 100 MiB of report text and screenshots per UTC day; anonymous
addresses may submit five reports daily. Metrics require a one-hour bearer
issued by `/api/telemetry/session`, limited to 50 issues per address and 10,000
globally per day. This capability is an admission signal, not proof of a real
installation or protection against distributed automation. Quota rejections
emit `Telemetry quota exceeded` or `Telemetry global report budget exceeded`.
Create log-based alerts for these messages and report/event volume, and a
Cloud Billing budget alert; no alert or budget is provisioned by this code.
The caps are conservative: retries and failed writes can consume admission.

Before enabling this version, configure bucket lifecycle deletion of objects
under `anonymous-screenshots/` at age two days and retain the existing 30-day
deletion for `screenshots/` and `recordings/`; configure Firestore TTL on
`cleanupAt`. GCS lifecycle and Firestore TTL are asynchronous, so deletion is
not immediate at the expiry time; application reads deny expired records.
Verify the policies and their execution in the target project. These external
policies are required for physical deletion and are not installed by deploy.

### Preparing cleanup and alerts

The following commands are an operator-reviewed change, not part of deploy.
Substitute the real project, bucket, Firestore prefix, service, notification
channel and billing account. Set a monthly budget in the billing account's
currency and tune the example volume thresholds in
`docs/operations/telemetry-alert-policy.json` to observed traffic. Cloud Billing
notifications can lag usage; they are not a hard spend limit.

```sh
telemetry_project='PROJECT_ID'
telemetry_bucket='PRIVATE_BUCKET_NAME'
telemetry_prefix='FIRESTORE_PREFIX'
telemetry_service='fuse-riders-gateway'
telemetry_channel='projects/PROJECT_ID/notificationChannels/CHANNEL_ID'
telemetry_billing='BILLING_ACCOUNT_ID'
telemetry_budget='100USD'

# Preserve all existing lifecycle rules. Review the merged JSON before applying:
gcloud storage buckets describe "gs://${telemetry_bucket}" --project "$telemetry_project" --raw --format=json > /tmp/telemetry-bucket.json
jq --slurpfile rule docs/operations/telemetry-anonymous-lifecycle-rule.json \
  '(.lifecycle // {rule: []}) | .rule = ((.rule // []) + $rule | unique)' \
  /tmp/telemetry-bucket.json > /tmp/telemetry-lifecycle.json
cat /tmp/telemetry-lifecycle.json
gcloud storage buckets update "gs://${telemetry_bucket}" --project "$telemetry_project" --lifecycle-file=/tmp/telemetry-lifecycle.json

# Each collection group owns a cleanupAt timestamp. Enable the default database TTLs.
for suffix in reports recordings recording-segments limits events memberships rollups actions action-tokens; do
  gcloud firestore fields ttls update cleanupAt --project "$telemetry_project" \
    --collection-group="${telemetry_prefix}-telemetry-${suffix}" --enable-ttl
done

# Log counters use request counts (a request can contain a batch), plus the
# exact shared-budget rejection log; these do not include private report text.
gcloud logging metrics create fuse_telemetry_reports --project "$telemetry_project" \
  --log-filter="resource.type=cloud_run_revision AND resource.labels.service_name=\"${telemetry_service}\" AND httpRequest.requestUrl=~\"/api/telemetry/reports(\\\\?|$)\""
gcloud logging metrics create fuse_telemetry_events --project "$telemetry_project" \
  --log-filter="resource.type=cloud_run_revision AND resource.labels.service_name=\"${telemetry_service}\" AND httpRequest.requestUrl=~\"/api/telemetry/events(\\\\?|$)\""
gcloud logging metrics create fuse_telemetry_quota --project "$telemetry_project" \
  --log-filter="resource.type=cloud_run_revision AND resource.labels.service_name=\"${telemetry_service}\" AND (textPayload:\"Telemetry quota exceeded\" OR textPayload:\"Telemetry global report budget exceeded\")"
gcloud monitoring policies create --project "$telemetry_project" \
  --policy-from-file=docs/operations/telemetry-alert-policy.json --notification-channels="$telemetry_channel"
gcloud billing budgets create --billing-account="$telemetry_billing" --display-name='Fuse project monthly spend' \
  --filter-projects="projects/${telemetry_project}" --budget-amount="$telemetry_budget" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 --notifications-rule-monitoring-notification-channels="$telemetry_channel"

# Verify the effective policies, TTL state, log metrics, alert and budget.
gcloud storage buckets describe "gs://${telemetry_bucket}" --project "$telemetry_project" --raw --format='json(lifecycle)'
gcloud firestore fields ttls list --project "$telemetry_project"
gcloud logging metrics list --project "$telemetry_project" --filter='name:fuse_telemetry_'
gcloud monitoring policies list --project "$telemetry_project" --filter='displayName="Fuse telemetry intake and quota"'
gcloud billing budgets list --billing-account="$telemetry_billing"
```

Metrics and policy creation commands are for a first installation; inspect and
update existing resources instead of creating duplicates. Verify a test object
is removed after the asynchronous lifecycle window and send a controlled test
alert through the chosen channel. The sample thresholds count HTTP requests,
including refused requests, not the number of events within each batch.
Also inspect bucket object versioning and soft-delete settings: lifecycle
deletion can leave noncurrent or soft-deleted copies billable beyond two days.
Choose and verify their retention separately before claiming physical deletion.

The worker validates reserved object ownership/generation, uses fenced leases
for duplicate/concurrent deliveries and persists transcripts and extraction
before acknowledging. Delivery retries transient failures; inspect visible
permanent failures and retry them after correction. Keep object finalization,
push delivery, worker authentication and transcription failure evidence private.

Action evidence links at most 20 ready, unexpired reports per transcript segment,
ordered by recording offset, expiry and ID. This bounds extraction context even
when many reports cover the same speech. The recording's paginated reports list
remains the complete source; the evidence list is a bounded selection. Reports
submitted after extraction stay on the session page; they do not retroactively
refresh an action's evidence links.

`OPENAI_TRANSCRIPTION_MODEL` defaults to `gpt-transcribe`, documented at
$0.0045/minute (about $0.27/hour for transcription; action extraction,
storage and hosting cost extra). Preserve Norwegian
and English speech. `OPENAI_ACTION_MODEL` defaults to `gpt-6.1-sol` with medium
reasoning for structured extraction. Model/account availability, billing and
real Norwegian dialect/code-switch quality still need acceptance evidence.
Sources checked 2026-11-14:
[transcription model](https://developers.openai.com/api/docs/models/gpt-transcribe),
[speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text),
[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Before an authorized release run `pnpm typecheck`, `pnpm test`,
`pnpm test:coverage`, `pnpm build` and relevant browser checks. Verify the exact
deployed source and endpoint; exercise allowlist denial/acceptance, real mic
capture/playback, browser closure after upload, durable worker redelivery and a
real Norwegian/English sample before claiming production readiness.

## Verification evidence and pending acceptance

Integration test results and private browser evidence are recorded in the PR.
The private bucket, queue and IAM are provisioned; activation evidence is tracked
in [the activation inventory](online/DEVELOPER-INSIGHTS-ACTIVATION.md). Production
reporting, private media storage and synthetic Norwegian/English transcription
with proposed tasks are verified live. Real microphone/dialect samples,
individual admin sign-in and physical-device acceptance remain. The inventory
also records the unresolved global coverage threshold failure on main.
