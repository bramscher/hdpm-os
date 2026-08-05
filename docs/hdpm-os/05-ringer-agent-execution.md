# HDPM-OS — Agent Execution Layer: Ringer Evaluation & Integration Plan

> Status: exploration draft, 2026-08-03. Primary-source research fetched
> 2026-08-03 from github.com/NateBJones-Projects/ringer (repo root, raw
> README, LICENSE.md, commits, issues, releases, ringer.py,
> config.sample.toml, templates/, docs/, hud/).

## 1. What Ringer actually is (FACTS, fetched)

- **Repo:** https://github.com/NateBJones-Projects/ringer — "Parallel
  AI-agent swarms that prove their work. Your expensive model plans and
  reviews; cheap workers do the typing."
- **License: PolyForm Shield 1.0.0** (© Nate Jones Media LLC) — source-
  available, *not* OSI open source: free internal commercial use, but no
  building a competing product on it, no sublicensing. HDPM's internal use is
  permitted; a future "sell the agent layer" product could **not** embed it.
- **Maturity:** ~1 month old (first release 2026-07-03), 235 stars, ~94
  commits, one primary maintainer + 5 drive-by contributors, 8 open issues
  that are real footguns (Python 3.12 gate breaks stock macOS; retry
  overwrites good attempt-1 patches; scoreboard can't distinguish model
  failure from check bug; "two orchestrator failure modes executed checks
  don't catch").
- **Architecture:** a single 11,135-line Python file (`ringer.py`), stdlib
  only. **Manifests** are JSON task packets: `key`, `spec` (worker prompt),
  `check` (shell command, exit 0 = PASS), `expect_files`, `engine`, `model`,
  `timeout_s`, `max_attempts`, `redact_spec`, `verified` (plain-English
  description of what the check proves). Workers are **subprocesses of
  third-party agent CLIs** (Codex, Grok CLI, OpenCode+OpenRouter, or any CLI
  via TOML `args_template`) in isolated per-task directories.
- **Verification:** the orchestrator executes the check itself — "Ringer
  doesn't take the worker's word for anything." One retry with failure output
  injected. `lint` flags un-failable checks; `--baseline` runs checks against
  the unmodified tree.
- **Model routing:** evidence-based — a model becomes "proven" per task_type
  after ≥3 tasks at ≥0.67 first-try pass rate (untested → probation →
  proven).
- **Audit/cost:** every attempt appended to `~/.ringer/runs.jsonl` (spec,
  model, tokens, duration, raw check output, verdict); optional Postgres
  (Supabase) eval backend; "Ringside" local web dashboard + Tauri HUD
  (read-only).
- **Isolation/secrets:** macOS-only Seatbelt sandbox (writes confined;
  **network and reads stay open**); `full_access` mode is one config flag;
  provider keys live in each CLI's own config — Ringer holds none;
  `redact_spec` hides prompts from logs but worker output can still echo
  them.
- **Integration surface:** **CLI + JSON file drop only. No submission API.**
  The HTTP servers are read-only dashboards. `self-update` pulls
  origin/main by default (disable via `RINGER_NO_SELF_UPDATE=1`).

## 2. Recommendation: **adopt the pattern; use the tool only in a fenced lane**

Ringer's *ideas* are exactly right for HDPM-OS — bounded task packets,
executed verification, cheap-worker/premium-reviewer routing, cost + audit
per attempt, retry-with-failure-context. Those ideas should shape our
execution layer regardless of the tool.

Ringer the *software* is a one-month-old, single-maintainer, single-user,
single-machine CLI whose security model is "anyone who can write a manifest
can execute arbitrary shell as your user," with macOS-only sandboxing that
leaves network open, and a non-OSS license that blocks the agent-team
product path (agent-os Q7). That profile dictates the deployment:

- **Yes:** as a **development/analysis workbench** on an isolated machine —
  code tasks on this repo (migration swarms, test generation, doc audits,
  adversarial review of PRs), synthetic-data experiments, SOP structural
  audits against public docs. Pin a release; disable self-update; never feed
  it real tenant/owner/employee/applicant data; never give it SoR
  credentials.
- **No:** as the production execution service wired into HDPM-OS. The
  production path is a thin internal runner that borrows the manifest/verify
  shape (below) — or Ringer later, *if* it matures into a servable, authed,
  sandboxed system (track upstream; re-evaluate quarterly).

## 3. The HDPM execution contract (pattern, tool-agnostic)

The orchestrator (in-app, doc 03 §2) emits **work specs** shaped like Ringer
manifests plus HDPM governance fields:

```jsonc
{
  "key": "sop-audit-move-in-2026q3",
  "origin": {"proposal_id": "…", "approved_by": "craig@…", "issue_id": "…"},
  "class": "read_only_analysis",          // vs "artifact_draft" — never "side_effect"
  "spec": "…bounded instructions…",
  "context_packet": ["sop/move-in-v7.md", "checklist-schema.json"],  // allowlisted inputs ONLY
  "redactions_applied": ["tenant_names", "unit_addresses→ids"],
  "check": "python verify_audit.py --schema out/audit.json",
  "verified": "output is valid JSON listing every SOP step with a pass/fail and a cited line",
  "model_tier": "worker",
  "max_attempts": 2, "timeout_s": 900,
  "budget_usd": 2.00
}
```

Governance rules:
1. **Workers receive only the context packet** — assembled by the
   orchestrator from brain queries + OS rows, minimized and pseudonymized
   (entity ids, not names, unless the task requires otherwise and the
   approval said so). Workers never receive: credentials, ledger data,
   screening data, door codes, employee records, or "the database."
2. **Two classes only:** `read_only_analysis` (artifact in, artifact out) and
   `artifact_draft` (a draft a human will use). **Side-effectful work is not
   dispatchable** to this layer — sends, record changes, purchases, and
   anything external route through the proposal spine and human taps
   (doc 03 §5). The runner physically has no tokens to do otherwise.
3. **Verification honesty.** Executable checks prove *structure and
   consistency* (schema-valid, sections present, N citations resolve, totals
   tie out, tests pass) — they cannot prove a memo is *true or good*. So:
   code/data tasks → executed checks are primary; research/drafting →
   executed structural checks **plus** a premium-model adversarial review
   pass **plus** human acceptance. The `verified` field states in plain
   English exactly what was and wasn't proven — that sentence travels with
   the artifact into the approval card. (Ringer's own open issues #45/#65
   confirm this limit is real.)
4. **Results storage:** a `work_run` table (`id, spec_json, origin refs,
   status, attempts, artifacts (Supabase storage refs), check_output,
   tokens, cost_usd, model, started/finished`) — the runs.jsonl idea, in our
   DB, joined to proposals so Ringside-style activity is visible **inside
   HDPM-OS** (Agents console gets a "Runs" tab: live status, cost per run,
   per-model pass rates). Failed runs after retry → an `issue` row + Slack
   escalation to the requesting human with the failure context attached;
   humans decide re-scope vs. do-it-manually.
5. **Cost:** per-run `budget_usd` hard caps + monthly circuit breakers per
   agent (Q5 pattern); the per-model scoreboard (pass rate, cost) drives
   routing exactly as Ringer's proven-tier idea prescribes.
6. **Secrets:** the runner host holds only its own LLM provider key(s) in the
   CLI's config; specs/artifacts transit via object storage, not env.
7. **Suitable / unsuitable** (business examples):
   - Suitable: vendor-market research memos, SOP-vs-checklist drift audits,
     document comparison (lease template vs. new ORS text — flagging, not
     concluding), data classification/cleanup on mirror extracts, draft
     report generation, test/code development on this repo, cross-checking
     mirror consistency (WO↔bill↔invoice tie-outs).
   - Unsuitable (human-owned, agents may at most draft upstream in the
     proposal spine): tenant/owner communications, accounting changes,
     employment decisions, legal conclusions, lease enforcement, expense
     approval, publishing externally, any SoR modification.

## 4. Where it runs

PoC: Craig's workstation (macOS Seatbelt available) against this repo and
synthetic/public data only. If promoted: one small isolated VM ("runner
box"), no inbound ports, egress-restricted to LLM providers, artifacts
exchanged via Supabase storage, spec pickup via signed queue rows — the OS
polls/queues; the box never reaches the OS database with write credentials
beyond the `work_run` reporting token.

## 5. Sequencing

Phase 4 in the roadmap (after brain + EOS + CRM foundations): ship the
`work_run` table + orchestrator dispatch + one flagship read-only use case
(quarterly SOP drift audit feeding the Issues list). The Ringer-proper
workbench can start **now** for repo-development chores, because that lane
needs no production data and no integration.
