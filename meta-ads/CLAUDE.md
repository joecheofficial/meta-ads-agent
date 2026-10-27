# Rules for coding assistants working in this agent

This folder is the Meta Ads agent. It spends real money on a real ad account.
These rules apply to every assistant (Claude, Codex, Cursor, Copilot, any other).

## Credentials

- Never read, print, copy, grep, sed, cat or edit `.env` or any file holding a credential.
- Never echo, log or paste an access token, app secret or API key, even partially, even "to check it".
- If a command's output ever shows a credential, stop and tell the user. Do not reuse it.
- The agent redacts credentials from its own output. Do not disable or work around that.

## Safety gates are the user's, not yours

- Never edit anything under `src/` or `config/` to get past a safety gate, a refusal or a missing setting.
- If a command says "writes disabled", stop. Tell the user to set `META_ADS_WRITES_ENABLED=true` themselves if they want live writes. Do not set it for them and do not edit the code.
- Budgets are capped by `META_ADS_MAX_DAILY_BUDGET_CENTS` (default 2000 cents, $20 a day). The cap is the user's to change. Never raise it, remove it or edit the check.
- Confirmation phrases (`CONFIRM PAUSE <id>`, `CONFIRM DELETE <id>`, `CONFIRM BUDGET <id>`, `CONFIRM RULE <name>`) must be typed by the user. Never invent or auto-fill them.
- `doctor` compares `src/` and `recipes/` against `config/src-checksums.json`. If it reports changed files, say so plainly; do not regenerate the checksums to make the warning go away.

## Language (English and French)

- Write ad copy, plans, reports and questions in the owner's language: French if they write in French, otherwise English. Keep Meta field names and IDs as they are.
- The policy check has French word lists for every text rule, and French copy is detected as French. Run it on French text exactly as on English. A PASS means no known pattern matched, not that the ad is approved: keyword lists have gaps, so still read French copy against Meta's rules.
- Other languages are only partly covered. If the check says a language was not checked, say so and ask the owner to review that text by hand.

## How to preview safely

- Use `--dry-run` on any write command. It prints what would be sent, writes an audit entry marked `dryRun: true`, and never calls a write endpoint. Dry runs work with writes off.
- Read commands (`campaigns list`, `adsets list`, `insights`, `account`, `doctor`) are always safe to run.
- When unsure whether something is a write, treat it as one.

## Connector mode (Meta's official Ads connector)

The main way to reach Meta is Meta's official Ads connector (https://mcp.facebook.com/ads).
The agent does not make those calls, so its guardrails only run if you run them. Before you
create or edit anything through the connector:

1. Run `node src/index.js policy check "<ad text>"` on every ad's text and on any Content Studio handoff file. On BLOCK, stop. Go ahead only if the owner gives a reason; log it with `audit log-external "Policy override: <reason>"`.
2. Create every campaign, ad set and ad PAUSED. Turning anything on is the owner's call.
3. Never set a daily budget above the cap shown by `node src/index.js doctor` (it prints the cap in cents and dollars and whether writes are on). Never open `.env` to find it.
4. Show the full plan (names, objective, audience, budget, ad text, status) and wait for the owner's yes.
5. After each connector change, run `node src/index.js audit log-external "<what changed, ids if known>"`.

The recipe "Build my creative test through the connector" does steps 1 to 3 and prints the plan. Details: `docs/CONNECTOR-MODE.md`.

## If you are asked to "self-heal" or "just make it work"

The answer is to explain the gate, show the dry run, and hand the decision back to the user.
Editing the gate is never the fix.
