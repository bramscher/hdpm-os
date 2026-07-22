# Company Soul — Readiness Gate (Scriptwriter)

**Status:** Draft (June 2026)  
**Audience:** Engineering + product  
**Related:** [company-soul-change-spec.md](./company-soul-change-spec.md), [video_generation/script-writing-guide.md](./video_generation/script-writing-guide.md), `src/lib/mashi-copilot/marketing-video-context-gate.ts`

---

## 1. Purpose

Before Dialogue scriptwriter generates a script, the system checks whether **Company Soul** (structured JSONB) has enough information to write a **good**, company-specific script for the episode topic (e.g. “Our Core Values”).

If not ready:

1. **Soul enhancement chat** runs inline in Dialogue Studio — targeted questions, one at a time  
2. Validated answers **merge into structured soul** (persistent, versioned)  
3. Readiness re-checks → generate proceeds when ready (or user overrides with warning)

This closes the loop: scriptwriting exposes gaps → chat fills soul → next script is better with less friction.

**Reference implementation:** Video Editor **context gate** (`marketing-video-context-gate.ts`) — analyze → ask → validate → pass context to outline. The Soul gate differs in that verified answers **update canonical soul**, not only ephemeral episode supplemental context.

---

## 2. Flow

```text
Save DialogueScriptBrief
        ↓
Soul readiness check (topic + brief + structured soul)
        ↓
┌─ ready ──────────────────────────→ POST dialogue-episode-generate-script
│                                      (includes resolveSoulContext slice)
│
└─ not ready ─→ Dialogue Studio: soul enhancement mode
                    ↓
              User answers gap questions (chat)
                    ↓
              validateSoulEnhancementAnswer()
                    ↓
              mergeAnswerIntoStructuredSoul() → soul vN+1, re-render md
                    ↓
              Re-check readiness → Generate when ready
                    (optional: "Generate anyway" with warning)
```

### Where it runs

| Surface | Trigger |
|---|---|
| Dialogue create (`/dialogue-video/create`) | User clicks **Generate script** after brief complete |
| Dialogue episode editor | **Regenerate script** / overwrite |
| Studio chat | Proactive: “I need one more thing about your values before I write this” |

---

## 3. Two layers of readiness

Combine **deterministic checks** (fast) with **LLM analyze** (script-specific).

### 3.1 Layer 1 — Deterministic

**New:** `src/lib/soul/readiness-gate.ts`

```typescript
assessSoulReadiness(params: {
  soul: CompanySoulStructured | null;
  topic: SoulContextTopic;       // derived from brief
  thresholds?: {
    sectionMinCoverage?: number; // default 60
    minValues?: number;          // for core-values topic
    requireSummary?: boolean;
  };
}): {
  ready: boolean;
  blockers: SoulReadinessBlocker[];
}

type SoulReadinessBlocker = {
  code: 'no_soul' | 'section_empty' | 'section_thin' | 'missing_typed_fields';
  section?: SoulSection;
  message: string;
};
```

**Example — topic `core-values`:**

| Check | Fail if |
|---|---|
| Soul exists | No `soul_files` row for brand/company |
| Section coverage | `Culture & Values` < 60 |
| Typed content | `values.length` < 3 |
| Summary | `summary` empty or too short |
| Brand voice | `Brand Voice` thin when script needs tone |

### 3.2 Layer 2 — LLM analyze

When deterministic checks pass or user requests full analyze:

- Input: `DialogueScriptBrief`, `resolveSoulContext({ topic, budget })`, existing `gaps` / `coverage`  
- Job: *“For this specific episode, what holes would force the scriptwriter to invent?”*  
- Output: up to N gaps (see strictness config below)

```typescript
type SoulReadinessGap = {
  id: string;
  soulSection: SoulSectionKey;
  topic: string;
  question: string;      // story-driven, one question
  rationale: string;
};
```

Reuse patterns from `marketing-video-context-gate.ts`:

- `ContextGap` / `VerifiedContextAnswer` shapes  
- Strictness: `lenient` | `balanced` | `strict`  
- `maxGaps`, `maxAttemptsPerGap`  
- Separate analyze + validate prompts  

---

## 4. Topic requirements

Map episode brief → `SoulContextTopic` → required sections and minimum bars.

| Topic | Derived from brief | Required sections | Minimum bar |
|---|---|---|---|
| `core-values` | Title/description mentions values, culture | Culture & Values, Brand Voice, Mission & Vision | ≥3 named `values[]` with meaning or example |
| `origin` | About us, founder story | Origin Story, Mission & Vision | Captured origin + founder intent |
| `dyk-education` | DYK, myth/reality, owner education | Customers, Products & Services, Decision Frameworks | Audience alignment + teachable angle |
| `service-explainer` | Process, what we do | Products & Services, Customers, Competitive Positioning | Process + differentiator |
| `general` | Default | Summaries from all non-empty sections | No section at 0% for primary funnel topic |

Add `soulTopic?: SoulContextTopic` to `DialogueScriptBrief` (optional explicit override).

---

## 5. Enhancement chat

### 5.1 Persona

**Script Writer + Soul Curator** — not the full Company Soul interviewer.

- One question at a time  
- Story-driven (“tell me about a time…”), not form-driven (“list your values”)  
- Same philosophy as Company Soul PRD: stories reveal knowledge  

### 5.2 UX by gap size

| Gap size | UX |
|---|---|
| **Small** (1–3 facts) | Inline Studio chat; validate → merge into soul |
| **Large** (whole section empty) | Offer deep link to Company Soul with gap focus: `/dashboard/developer-admin/company-soul?focus=Culture%20%26%20Values` |
| **No soul** | Block generate; prompt to start Company Soul or run mini-capture in chat |

### 5.3 Validate answer

Mirror `buildContextGateValidateSystemPrompt`:

```typescript
validateSoulEnhancementAnswer(params: {
  gap: SoulReadinessGap;
  answer: string;
  soulSlice: string;
  brief: DialogueScriptBrief;
  strictness: ContextGateStrictness;
}): { accepted: boolean; feedback?: string }
```

- Reject vague fluff, contradictions with soul, empty “I don’t know” without direction  
- Accept concrete stories, named examples, quotable principles  

### 5.4 Merge into soul (critical)

Unlike Video Editor supplemental context, **answers persist to structured soul**:

```typescript
mergeAnswerIntoStructuredSoul(params: {
  soulFileId: string;
  gap: SoulReadinessGap;
  answer: string;
}): Promise<SoulFileRow>
```

Steps:

1. Map gap → target section + field (`values[]`, `quotes[]`, `summary`, etc.)  
2. Merge into `structured` (LLM-assisted struct extraction or rule-based append)  
3. Re-score section coverage (lightweight or full SCORE pass)  
4. Re-render markdown → `content`  
5. Save new version (`version + 1`)  

**Skip path:** User skips → store on episode only as `script_brief.soulEnhancementSkipped[]` or reuse `MarketingVideoSupplementalContext.unavailableTopics` pattern — scriptwriter must not invent on those topics.

---

## 6. API surface

| Route / tool | Role |
|---|---|
| `POST /api/soul/readiness` | `{ brandId?, companyName?, brief, topic? }` → `{ ready, blockers, gaps?, soulVersion }` |
| `POST /api/soul/enhance/validate` | Validate one chat answer |
| `POST /api/soul/enhance/merge` | Merge validated answer → structured soul, return new version |
| `POST /api/mashi-copilot/dialogue-episode-generate-script` | Call readiness first (or require client passed `readinessToken`); inject `resolveSoulContext()` slice |

**Dialogue Studio chat tools (alternative to standalone routes):**

| Tool | Role |
|---|---|
| `check_soul_readiness` | Run assess + optional analyze |
| `ask_soul_gap_question` | Present next gap to user |
| `merge_soul_enhancement` | After validate, persist to soul |

---

## 7. Script generation integration

When ready (or override):

```typescript
const slice = resolveSoulContext({
  soul: structured,
  topic: deriveTopicFromBrief(brief),
  maxChars: 4000,
});

// In buildMasterTranscriptPrompt / buildSplitPrompt:
`
COMPANY SOUL (authoritative — do not invent beyond this):
${slice.slice}

RULES:
- Every value/fact in the script must appear in the soul slice or brief.
- Match brand voice from soul.
- Do NOT use myth→reality framing unless brief topic is dyk-education.
`
```

Episode-type conditionals (e.g. skip myth/reality for `core-values`) live in `dialogue-script-generate.ts`.

---

## 8. Relationship to Company Soul page

| Surface | Role |
|---|---|
| **Company Soul page** | Deep capture: long interview, gap pills, full compose |
| **Scriptwriter enhancement chat** | Surgical capture: 2–5 questions triggered by a specific script |

Same structured soul, two entry points.

Optional future UI on Company Soul page:

- “Last enhanced from Dialogue scriptwriter” on section metadata  
- Link: “Requested by Core Values episode, Jun 2026”  

---

## 9. Strictness and overrides

Reuse `CONTEXT_GATE_STRICTNESS_VALUES` or soul-specific defaults:

| Mode | Behavior |
|---|---|
| `lenient` | Warn only; allow generate with generic fallback copy flagged |
| `balanced` | Block generate until critical blockers resolved or skipped |
| `strict` | Require typed fields (e.g. 3 values) before generate; no override |

**Generate anyway:** Power-user escape hatch — show “Script may invent or genericize: [topics]”.

---

## 10. Pitfalls to avoid

1. **Gate only on coverage %** — require typed fields where it matters (`values[]` for Core Values)  
2. **Chat answers that never hit soul** — loses compounding benefit  
3. **Duplicate 30-minute interview in Studio** — cap at ~5 gaps per session  
4. **Generate without re-check** — refresh soul slice after merge  
5. **Blocking forever** — always offer skip or deep link to full Company Soul  

---

## 11. Phasing

| Phase | Deliverable |
|---|---|
| **A** | `assessSoulReadiness()` deterministic; warn/block on generate |
| **B** | LLM analyze for script-specific gaps |
| **C** | Dialogue Studio enhancement chat + validate |
| **D** | `mergeAnswerIntoStructuredSoul` + version bump + re-render |
| **E** | Deep link to Company Soul interview for large gaps |
| **F** | Wire `resolveSoulContext()` into dialogue generate prompts |

Depends on [Phase 1 structured soul](./company-soul-change-spec.md#phase-1--foundation) from change spec.

---

## 12. Acceptance criteria

- [ ] “Our Core Values” brief with thin soul → generate blocked or chat starts with specific gap question  
- [ ] User answer merges into `structured.sections.cultureAndValues` and bumps version  
- [ ] Re-generate script uses merged content; no invented values  
- [ ] Skip records unavailable topic; script does not fabricate that topic  
- [ ] Large gap offers Company Soul deep link with focus topic  
- [ ] `resolveSoulContext` sent to generate is ≤ char budget and topic-relevant  
