# Developer analytics explorer

The overview answers “who is playing, what are they playing, and are rounds finishing?” Player Sessions answers “what happened during this visit?” Raw Events answers “which exact observations explain this result?” Reports, recordings and proposals remain available as separate views.

The interface inherits Fuse Games tokens and uses a compact data workspace: a persistent section bar, shared date/game controls, a visible OR-of-AND filter builder, summary measures, numbered chart axes, and tables with selectable property columns. The app is built directly in code. Clicking a dimension adds an AND constraint to every existing OR branch, preserving the selected expression. A session click selects its player and session together.

Event queries use a bounded, newest-first storage query with stable time/id pagination. Each scan reads at most 2,001 documents. The UI can continue through older slices; it labels incomplete results, marks lower-bound counts and withholds incomplete charts. DAU and calendar-month active browsers are deduplicated from the matching month-to-date event scan, so arbitrary property constraints apply consistently; unavailable full history withholds these measures. Historical raw data expires after 90 days. Existing daily/weekly/monthly rollup APIs remain available.

Events represent browser participation. New lifecycle events carry irreversible, domain-separated hashes of a shared match/round scope so the explorer can link reported participants without transmitting room capabilities, peer identifiers or names. Old events cannot reconstruct missing participants. Sessions keep their existing origin-wide 30-minute inactivity behavior.

The assistant uses bounded Responses API function calls against a browser command adapter. The adapter navigates sections, edits dates, filters and columns, selects sessions, opens recordings, inspects the visible result and prepares issue drafts. It cannot bypass server authorization or publish without the visible issue composer. User and global quotas, a durable in-flight lease, input/output bounds, provider timeout and a per-turn step limit cap work.

GitHub OAuth is linked to the existing Firebase player. The resulting provider token is validated by GitHub and encrypted with a domain-separated server key before database storage under that player's UID. Only status is returned. Disconnect removes usable credentials. Issue creation targets the configured project repository, uses editable redacted title/body, and records an idempotency marker and resulting link; source quotes and private media are excluded by default. Unknown provider outcomes remain visible and are reconciled before retrying.

Production activation requires the Firebase GitHub provider to be enabled. No deployment or merge is implied by implementation.
