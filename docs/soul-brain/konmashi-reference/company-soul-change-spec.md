# Company Soul — Change Spec

**Status:** Draft (June 2026)  
**Audience:** Engineering + product  
**Related:** [company-soul-prd.md](./company-soul-prd.md), [company-soul-readiness-gate.md](./company-soul-readiness-gate.md), [video_generation/script-writing-guide.md](./video_generation/script-writing-guide.md), `COMPANY_SOUL_README.md`

---

## 1. Summary

Company Soul is evolving from **markdown-as-source-of-truth** to **structured JSONB-as-source-of-truth**, with markdown as a **rendered export for humans**. The primary consumers are downstream systems (Dialogue scriptwriter, Kroids, future Brain) that need **topic-scoped slices**, not the full document.

This spec covers:

1. Data and backend changes to support structured Soul  
2. Company Soul page changes (UI, edit model, status display)  
3. Navigation and UX gaps in the current page  
4. Integration with Dialogue scriptwriter via [Soul Readiness Gate](./company-soul-readiness-gate.md)  
5. Phased rollout and acceptance criteria  

---

## 2. Design principles

| Principle | Implication |
|---|---|
| **Structured canonical** | `soul_files.structured` (JSONB) is the system of record |
| **Markdown is output** | `soul_files.content` is a cached render, regenerated on compose/edit |
| **Sparse by company** | Sections/fields may be absent; no rigid schema per row |
| **Selective retrieval** | Consumers call `resolveSoulContext({ topic, budget })` — never send full soul by default |
| **Interview unchanged** | Voice/text interview + gap pills remain the primary capture UX |
| **Transcript is audit trail** | `soul_interview_turns` stays relational; structured soul is derived from it |
| **Scriptwriter feeds soul** | Enhancement chat merges answers into structured soul (see readiness gate doc) |

---

## 3. Data model changes

### 3.1 `soul_files` table

**Add:**

| Column | Type | Notes |
|---|---|---|
| `structured` | `JSONB NOT NULL DEFAULT '{}'` | Canonical soul document |
| `brand_id` | `UUID NULL REFERENCES brands(id)` | Optional link to team brand (preferred lookup key long-term) |

**Repurpose:**

| Column | New role |
|---|---|
| `content` | Rendered markdown cache (human preview + download) |
| `coverage`, `gaps`, `confidence` | Derived from `structured` (may remain denormalized for query/UI speed) |

### 3.2 Structured JSONB shape (canonical)

Aligned to `SOUL_SECTIONS` in `src/lib/soul/sections.ts`. Keys use camelCase in JSON; map to display labels for UI.

```typescript
type CompanySoulStructured = {
  meta: {
    companyName: string;
    version: number;
    renderedAt?: string; // ISO — when content md was last generated
  };
  identity: {
    founderName?: string;
    industry?: string;
    website?: string;
  };
  sections: Partial<Record<SoulSectionKey, SoulSectionBlock>>;
};

type SoulSectionKey =
  | 'missionAndVision'
  | 'originStory'
  | 'customers'
  | 'productsAndServices'
  | 'decisionFrameworks'
  | 'operationsAndRhythm'
  | 'cultureAndValues'
  | 'brandVoice'
  | 'competitivePositioning'
  | 'future';

type SoulSectionBlock = {
  status: 'empty' | 'thin' | 'captured';
  summary: string;              // Short distillate — default for prompt injection
  prose?: string;               // Longer narrative — optional, for render + deep context
  quotes?: { text: string; context?: string }[];
  values?: { name: string; meaning: string; example?: string }[];
  principles?: string[];
  frameworks?: { name: string; whenToUse: string }[];
};
```

**Rules:**

- Missing section key = never captured for this company  
- `summary` should be kept short (target ≤ 500 chars per section)  
- Typed arrays (`values[]`, etc.) populated where interview material supports them  
- Section keys are flexible — new optional fields can be added without migration  

### 3.3 TypeScript updates

Update `SoulFileRow` in `src/lib/soul/sections.ts`:

```typescript
export type SoulFileRow = {
  id: string;
  company_name: string;
  file_name: string;
  version: number;
  structured: CompanySoulStructured;
  content: string;                     // rendered markdown cache
  confidence: number | null;
  gaps: string[];
  coverage: SoulCoverage;
  brand_id?: string | null;
  created_at: string;
};
```

---

## 4. Backend / composer changes

### 4.1 Compose pipeline (invert)

**Current:** `MAP → COMPOSE (markdown) → SCORE`

**Target:**

```text
1. EXTRACT  — MAP pass → structured sections (JSON)
2. MERGE    — prior structured soul as floor (no-loss rule)
3. SCORE    — coverage + gaps on structured content
4. RENDER   — deterministic template → markdown → soul_files.content
```

**Files:**

| File | Change |
|---|---|
| `src/lib/soul/compose.ts` | Output `CompanySoulStructured`; add `renderSoulMarkdown(structured)` |
| `src/app/api/soul/compose/route.ts` | Persist `structured` + rendered `content` |
| `src/app/api/soul/files/route.ts` | POST accepts structured patches or full structured body; re-render md |

### 4.2 Soul context resolver

**New file:** `src/lib/soul/prompt-context.ts`

```typescript
resolveSoulContext(params: {
  soul: CompanySoulStructured;
  topic: SoulContextTopic;       // e.g. 'core-values', 'dyk-education', 'general'
  maxChars?: number;             // default 4000
}): { slice: string; sectionsIncluded: SoulSection[]; warnings: string[] }

loadLatestSoulForUser(userId, { companyName?, brandId? }): Promise<SoulFileRow | null>
```

Topic → section mapping lives in the same file. Used by scriptwriter and readiness gate.

**Retrieval tiers (within each section):**

1. `summary` + typed arrays — default  
2. `prose` — only if budget remains or consumer is long-form  
3. Skip sections with `status: 'empty'` or coverage below threshold  

### 4.3 Edit API

**Current:** POST `/api/soul/files` with `{ baseId, content }` (markdown string)

**Target:**

```typescript
// Preferred
{ baseId, structured: CompanySoulStructured }

// Legacy (deprecated) — parse or reject
{ baseId, content: string }
```

On structured save: re-run render → update `content`, bump version, optionally re-score.

---

## 5. Company Soul page changes

**File:** `src/app/dashboard/developer-admin/company-soul/page.tsx`

### 5.1 Page goals (updated copy)

Update header description:

- **Capture:** Interview extracts tacit knowledge  
- **Power systems:** Structured soul feeds scriptwriter, Kroids, and future Brain  
- Markdown preview/download remains for human review  

### 5.2 Navigation

| Issue | Change |
|---|---|
| Page uses `DeveloperAdminSidebar`, which has no Company Soul link | Add **Company Soul** to `src/components/dashboard/DeveloperAdminSidebar.tsx` |

### 5.3 Interview panel (left column)

| # | Change | Priority | Notes |
|---|---|---|---|
| L1 | **New interview / company switcher** | P0 | Auto-resumes latest interview today with no escape hatch |
| L2 | **Remove hardcoded demo default** | P1 | `DEFAULT_COMPANY = 'High Desert Property Management'` → empty or from brand context |
| L3 | **Coverage strip before first compose** | P1 | Hide chips until soul exists, or show “Generate soul to see coverage” |
| L4 | **Optimistic send rollback** | P2 | On chat API failure, remove optimistic user turn or reload from API |
| L5 | **Compose progress** | P2 | Step indicator or elapsed time during 30–90s compose |
| L6 | **Link brand (optional field)** | P2 | Brand picker on start interview → `brand_id` on interview/soul |

**Unchanged:** Voice recording, waveform, gap pills, gap → focus interview, mic error messages.

### 5.4 Soul panel (right column)

| # | Change | Priority | Notes |
|---|---|---|---|
| R1 | **Section-based view (primary)** | P0 | Section cards from `structured.sections` — coverage, status, summary, typed fields |
| R2 | **Edit model: structured** | P0 | Per-section edit; save structured → re-render md |
| R3 | **Markdown preview tab** | P1 | Read-only rendered `content`; download uses this |
| R4 | **Version history** | P1 | View prior versions (structured + rendered md) |
| R5 | **Machine-readiness indicator** | P2 | “Ready for scriptwriter” when coverage ≥ threshold |
| R6 | **Topic slice preview (dev)** | P3 | Preview `resolveSoulContext()` output for a topic |

### 5.5 Generate / download

- Generate/regenerate writes structured + render  
- Download still produces `{CompanyName}.company.soul.md` from rendered cache  
- Deprecate freeform markdown edit; point users to section edit  

### 5.6 Code hygiene

- Remove unused `Badge` import on page  
- Fix README “9 sections” → **10** (`SOUL_SECTIONS` count)  
- Extract hooks/components when implementing R1/R2  

---

## 6. UI wireframe (conceptual)

```text
┌─────────────────────────────────────────────────────────────────┐
│ Company Soul                                                     │
│ Interview → structured knowledge → powers scripts & agents       │
├──────────────────────────────┬──────────────────────────────────┤
│ INTERVIEW                    │ COMPANY SOUL  v3  ·  71%         │
│ [Company ▼] [New interview]  │ [Generate] [Download .md]         │
│                              │                                  │
│ Coverage (after v1 exists)   │ ┌─ Mission & Vision ──── 82% ─┐ │
│ [chips from structured]      │ │ summary…                     │ │
│                              │ │ [Edit section]               │ │
│ [chat transcript]            │ └──────────────────────────────┘ │
│ [mic] [textarea] [send]      │ ┌─ Culture & Values ────── 68% ─┐│
│                              │ │ values: …                    ││
│                              │ │ [Edit section]                 ││
│                              │ └──────────────────────────────┘ │
│                              │ [Preview markdown ▼] [Versions ▼]│
└──────────────────────────────┴──────────────────────────────────┘
```

---

## 7. Migration

### 7.1 Existing rows

For `soul_files` with `content` but no `structured`:

1. Parse markdown headers (`## Mission & Vision`, etc.) → populate `structured.sections`  
2. Set `summary` via extract or mark `thin` until regenerated  
3. Regenerate recommended for quality  

### 7.2 API compatibility

- GET `/api/soul/files` returns `structured` and `content`  
- Page reads `structured` first; fallback to markdown-only for legacy rows  
- Compose always writes both going forward  

---

## 8. Phased implementation

### Phase 1 — Foundation

- [ ] Migration: `structured JSONB` + optional `brand_id`  
- [ ] Composer: EXTRACT → MERGE → SCORE → RENDER  
- [ ] Types, `renderSoulMarkdown()`, `resolveSoulContext()`  
- [ ] API: compose + files persist `structured`  

### Phase 2 — Company Soul page

- [ ] Section cards + structured edit (R1, R2)  
- [ ] Markdown preview + download (R3)  
- [ ] New interview / company switcher (L1)  
- [ ] DeveloperAdminSidebar link  
- [ ] Coverage strip gating (L3)  

### Phase 3 — Polish

- [ ] Version history (R4)  
- [ ] Compose progress (L5), brand linker (L6), readiness indicators (R5)  
- [ ] Optimistic send fix (L4), remove HDPM default (L2)  

### Phase 4 — Scriptwriter integration

See [company-soul-readiness-gate.md](./company-soul-readiness-gate.md):

- [ ] Soul readiness gate before generate  
- [ ] Enhancement chat in Dialogue Studio  
- [ ] Merge answers into structured soul  
- [ ] `resolveSoulContext()` in dialogue generate prompts  

---

## 9. Acceptance criteria

### Structured soul

- [ ] Generate Soul produces valid `structured` and rendered `content`  
- [ ] Regenerate never drops captured structured sections  
- [ ] Section edit → new version → `structured` updated → `content` re-rendered  
- [ ] `resolveSoulContext({ topic: 'core-values' })` returns ≤ budget chars, excludes unrelated sections  

### Company Soul page

- [ ] User can start a new interview without DB cleanup  
- [ ] Section cards reflect structured data  
- [ ] Download matches markdown preview  
- [ ] Company Soul visible in Developer Admin sidebar  
- [ ] Gap pills still steer interview; coverage reflects structured scores  

---

## 10. Files touched (checklist)

| Area | Files |
|---|---|
| Migration | `supabase/migrations/YYYYMMDD_company_soul_structured.sql` |
| Types | `src/lib/soul/sections.ts` |
| Compose / render | `src/lib/soul/compose.ts`, `src/lib/soul/render-markdown.ts` (new) |
| Context resolver | `src/lib/soul/prompt-context.ts` (new) |
| Readiness gate | `src/lib/soul/readiness-gate.ts` (new) — see readiness gate doc |
| API | `src/app/api/soul/**` |
| Page | `src/app/dashboard/developer-admin/company-soul/page.tsx` |
| Components | `src/components/company-soul/*` (new) |
| Nav | `src/components/dashboard/DeveloperAdminSidebar.tsx` |
| Dialogue | `src/lib/developer-admin/dialogue-script-generate.ts`, Dialogue Studio chat |

---

## 11. Open decisions

1. **Brand linkage:** Require `brand_id` on new souls, or keep `company_name` match for V1?  
2. **Section edit UI:** Inline accordion vs modal per section?  
3. **Legacy md edit:** Remove immediately or one-release deprecation with import parser?  
4. **Re-score on manual structured edit:** Auto-run SCORE pass or copy prior coverage until regenerate?  
5. **Enhancement merge:** New soul version per chat answer, or batch merge then one version bump?  
