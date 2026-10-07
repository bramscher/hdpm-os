---
ontology: true
type: spec
domain: hdpm-os
status: active
tags: [knowledge-capture, brain, appfolio, owners, properties, audio, transcription]
summary: Matt and Penny record what they know about each AppFolio owner and property; transcripts flow into the brain and roll up into living profiles.
related: [04-gbrain-company-brain, fee-management]
discovered: 2026-10-07
---

# Knowledge Capture

Matt and Penny carry years of knowledge about owners and properties that isn't written down anywhere: who to call, what an owner will and won't pay for, which vendor knows the crawlspace. They're transitioning out. **Knowledge Capture** (`/knowledge-capture`, Company menu) lets them talk it through, one owner or property at a time, so that knowledge stays in the company brain.

## Flow

1. **Pick a subject.** The list is every active AppFolio owner (owner sets split into people) and property. It comes from the same cached daily AppFolio pull as Fee Management (`lib/fee-management/facts-cache.ts`). Progress bars and the "Not captured yet" filter show what's left.
2. **Record.** Record in the browser (pause, resume, 45-minute cap per take) or attach a phone voice memo (25 MB max). Interview prompts sit beside the recorder (`lib/knowledge-capture/prompts.ts`).
3. **Upload.** The browser uploads straight to the private `knowledge-capture` Supabase bucket with a signed upload URL, so audio never passes through the API body limit.
4. **Process** (`POST /api/knowledge-capture/recordings/:id/process`):
   - **Transcribe** with OpenAI `whisper-1`, prompted with local place names. Override with `KC_TRANSCRIBE_MODEL`.
   - **Distill** the transcript into structured notes (Claude Opus 5.5). The notes contain only what the speaker said; anything unclear goes under "Open questions".
   - **Ingest** into the brain (`brain_chunk`, domain `company`, sensitivity `internal`):
     - transcript windows: `kind=fact`, author `human:<email>`
     - distilled notes: `kind=summary`, author `agent:knowledge-capture`
   - **Rebuild** the subject's profile from all of its recordings. The profile is stored in `kc_profile`, written to the subject's `brain_node.summary_md`, and ingested as a salience-1.2 chunk.
5. **Read.** Each subject page shows the profile, every take (audio, transcript, notes), retry for failed takes, delete (your own takes; admins can delete any), and "Rebuild profile".
6. **Correct.** **Edit** on a take opens its transcript in a text box under the audio player (`PATCH /api/knowledge-capture/recordings/:id`). Saving keeps the first machine transcript in `transcript_original`, records who edited it and when, and rebuilds that take's notes, its brain chunks and the profile from the corrected text. The audio is not re-transcribed, and Retry never overwrites an edit. Same permission as delete.

Dez and agents find this knowledge through ordinary brain retrieval (`searchBrain` / `think`).

## Brain identity

| Thing | Key |
|---|---|
| Owner node | `brain_node.slug = owner:appfolio:<v0 owner id>` |
| Property node | `brain_node.slug = property:appfolio:<v0 property id>` |
| Ownership | `brain_edge` owner → property, `relation = owns` |
| Transcript windows | `source_key = kc:rec:<recordingId>:t<n>` |
| Notes chunks | `source_key = kc:rec:<recordingId>:n<n>` |
| Profile chunk | `source_key = kc:profile:<type>:<id>` |

Re-processing a recording replaces its chunks. Deleting a recording removes its audio and chunks, then rebuilds the profile (or removes the profile if no recordings remain).

## Setup

1. Apply `supabase/migrations/20261014_knowledge_capture.sql` in the Supabase SQL Editor. It creates `kc_recording`, `kc_profile` and the private bucket.
2. Admin → User settings: switch **Knowledge Capture** on for Matt and Penny, and for anyone who should read the profiles. It's off by default because owner contact details and candid notes live here.
3. Production already has the env vars this needs: `OPENAI_API_KEY` (brain embeddings) and `ANTHROPIC_API_KEY` (brain think).

## Not yet

- Editing the profile directly. Correct the transcript instead, or record a correction take; the profile prefers newer notes and flags disagreements.
- Unit-level subjects and vendor profiles.
