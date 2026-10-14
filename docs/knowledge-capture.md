---
ontology: true
type: spec
domain: hdpm-os
status: active
tags: [knowledge-capture, brain, appfolio, owners, properties, audio, transcription, offline, pwa]
summary: Matt and Penny record what they know about each AppFolio owner and property; transcripts flow into the brain and roll up into living profiles.
related: [04-gbrain-company-brain, fee-management]
discovered: 2026-10-07
---

# Knowledge Capture

Matt and Penny carry years of knowledge about owners and properties that isn't written down anywhere: who to call, what an owner will and won't pay for, which vendor knows the crawlspace. They're transitioning out. **Knowledge Capture** (`/knowledge-capture`, Admin menu; only Matt, Penny and Craig — a fixed list in `lib/access/sections.ts`) lets them talk it through, one owner or property at a time, so that knowledge stays in the company brain.

## Flow

1. **Pick a subject.** The list is every active AppFolio owner (owner sets split into people) and property. It comes from the same cached daily AppFolio pull as Fee Management (`lib/fee-management/facts-cache.ts`). Progress bars and the "Not captured yet" filter show what's left.
2. **Add knowledge** three ways: record in the browser (pause, resume, 45-minute cap per take), attach a voice memo (25 MB max), or **Type or paste** in a popup (`POST /api/knowledge-capture/entries`). A typed note is stored as a take with no audio (`mime_type = text/plain`, empty `storage_path`, the text as its transcript) and then processed exactly like a recording, so notes, brain ingest, editing, voices and Perspectives all apply. Interview prompts sit beside the recorder (`lib/knowledge-capture/prompts.ts`).
3. **Upload.** The browser uploads straight to the private `knowledge-capture` Supabase bucket with a signed upload URL, so audio never passes through the API body limit.
4. **Review the transcript** (audio only). Upload is followed by transcription alone (`POST /recordings/:id/transcribe`). The take then waits as **Review transcript**: the text sits in an editable box under the audio player, and nothing reaches the brain, notes or profile until someone clicks **Add to brain**. If the text was changed, the machine transcript is kept as `transcript_original`. Takes waiting for review show a "N to review" badge and a **To review** filter in the list. Typed notes skip this step.
5. **Process** (`POST /api/knowledge-capture/recordings/:id/process`, optional body `{ transcript }`: the reviewed text):
   - **Transcribe** with OpenAI `whisper-1`, prompted with local place names. Override with `KC_TRANSCRIBE_MODEL`.
   - **Distill** the transcript into structured notes (Claude Opus 5.5). The notes contain only what the speaker said; anything unclear goes under "Open questions".
   - **Ingest** into the brain (`brain_chunk`, domain `company`, sensitivity `internal`):
     - transcript windows: `kind=fact`, author `human:<email>`
     - distilled notes: `kind=summary`, author `agent:knowledge-capture`
   - **Rebuild** the subject's profile from all of its recordings. The profile is stored in `kc_profile`, written to the subject's `brain_node.summary_md`, and ingested as a salience-1.2 chunk.
5. **Read.** Each subject page shows the profile, every take (audio, transcript, notes), retry for failed takes, delete (your own takes; admins can delete any), and "Rebuild profile".
6. **Correct.** **Edit** on a take opens its transcript in a text box under the audio player (`PATCH /api/knowledge-capture/recordings/:id`). Saving keeps the first machine transcript in `transcript_original`, records who edited it and when, and rebuilds that take's notes, its brain chunks and the profile from the corrected text. The audio is not re-transcribed, and Retry never overwrites an edit. Same permission as delete.

7. **Link owner records.** AppFolio can hold one person as several owner records. Profiles are already per person, not per ownership group, so someone in {John, Mary} and in {John, Bob} is one John profile, and a partner unique to a group (Bob) keeps their own. Nothing to link there. The **Linked records** card on each owner handles the rest (`lib/knowledge-capture/links.ts`, table `kc_owner_link`):
   - **Same person**: duplicate records merge into the profile being viewed. Recordings stay on their original record id and resolve to the kept profile when read, so **Unlink** splits them back into two profiles. (Merging a record that already had its own duplicates moves those onto the kept profile; unlinking undoes only the record you unlink.) Brain edge: kept `supersedes` duplicate.
   - **Related**: a different person or entity that belongs with this one (their trust or LLC, a spouse, a partner), with an optional note. Separate profiles that name each other. Brain edges: `related_to` both ways.
   - **Not the same**: dismisses a suggestion.
   - **Suggestions**: same email, phone or exact name → likely the same person; one name's words all inside another's (John Smith ↔ John Smith Family Trust) → likely related. The list has a "Possible duplicates" filter and a **Check** badge. A person always decides.

8. **Both people's knowledge.** Every recording records whose voice is in it (`kc_recording.voices`: Matt, Penny, or both talking together), separate from who pressed record. "Who's talking?" defaults to whoever is signed in.
   - The list shows an M/P dot per owner and property (filled = their take is recorded), with **Needs Matt's take** and **Needs Penny's take** filters: covered by someone, not yet by that person. Since it'll mostly be Matt, Penny can work down "Needs Penny's take".
   - Notes attribute judgment calls to the person. In a joint take, statements are attributed only when it's clear who said them.
   - Once more than one person has contributed, the profile adds **Perspectives**: each person's take, plus where they differ. One view never overwrites the other.
   - Anyone whose voice is in a take, or who recorded it, can edit or delete it.

9. **iPhone.** Everything works in Safari on iPhone:
   - Recording uses `audio/mp4`. Keep the screen open, because iOS pauses the mic when the phone locks or you switch apps.
   - Voice memos attach from Files; Share → Save to Files first. Files with no MIME type are recognized by extension.
   - Inputs are 16px on phones, so iOS doesn't zoom in on focus.
   - On phones the list and the profile are separate screens, with an "All owners" back link.

10. **Works with no signal (Home Screen app).** Capture installs as a Home Screen app ("Capture") that opens and records with no signal, then uploads when the phone is back online.
    - **Install:** in Safari, open `/knowledge-capture` while you have signal → Share → **Add to Home Screen** → open it from the Home Screen once and sign in. (Android Chrome: **Install**.) The page shows this hint on phones until dismissed. The Home Screen app keeps its own sign-in, separate from Safari.
    - **Opens offline:** `public/kc-sw.js` (a service worker registered by the page in production) saves the page, the code it needs, the owner/property list, and each profile you've opened. With no signal, or weak signal (4s), or an expired session, the app opens the saved copy; a banner says it's offline and when the list was saved.
    - **Every take stays on the device until the server has it** (`lib/knowledge-capture/outbox.ts`, IndexedDB). While recording, each second of audio is written to the device, so closing the app, a crash or a dead battery keeps everything up to the last second. Save queues the take; **On this device** at the top of the page lists what's waiting.
    - **Uploads by themselves** when the app is open with signal: on open, back online, brought forward, and every 30s. iPhone can't upload in the background, so open the app once you're back in signal. A take cut off mid-recording shows as **Not saved**, with Play / Save / Discard. An expired session (8 hours) shows **Sign in to upload**; takes wait.
    - **Retry-safe:** the device picks the take's id, so a retried upload reuses the same `kc_recording` row (`POST /recordings` with `id`), and transcription of a take that already has a transcript returns it rather than paying Whisper again. `recordedAt` from the device becomes `created_at`, so a take is dated when it was recorded, not when it uploaded.
    - Typed notes, transcript review and Add to brain still need signal.

12. **Quick capture.** Record before picking an owner or property: the **Quick capture** card at the top of the page (also **Attach voice memo**, so a Voice Memos recording needs no subject either).
    - The take uploads and transcribes untagged (`kc_recording.subject_type` NULL, audio under `inbox/`). With no signal it waits on the device like any take.
    - The **Inbox** lists untagged takes with playback and transcript. **Tag** searches owners and properties together; picking one files the take there (`POST /recordings/:id/tag`, untagged rows only) and opens that page for transcript review and **Add to brain**.
    - Nothing untagged reaches the brain, coverage counts or a profile: processing and transcript edits refuse untagged takes.
    - Who can tag, retry or delete: whoever recorded it, anyone whose voice is in it, or an admin.

11. **Fee change risk.** **Fee change risk** in the header lists the owners the proposed fee change is most likely to cost us, from Fee Management → Fee Schedule → Fee fatigue & churn (same math, the saved fee schedule): **Large-owner exposure** (16+ doors by default) and the top 10 **Most at risk**.
    - Each owner has a notes field for Matt and one for Penny (`fee_risk_note`, one note per owner set per person; Craig's shows once he writes one). Everyone sees all notes; each person edits only their own. The same notes appear in Fee Management's tables.
    - Fee campaign only: these notes don't go to the brain. For knowledge the brain should keep, record a take.
    - At-risk owners also get a **Fee change risk** card on their capture page; **Record about them** jumps there from the list.
    - Matt and Penny don't need Fee Management access: `GET /api/knowledge-capture/fee-risk` computes the list server-side under the Knowledge Capture section.

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

1. Apply `supabase/migrations/20261014_knowledge_capture.sql` in the Supabase SQL Editor. It creates `kc_recording`, `kc_profile` and the private bucket. Then apply `20261015_kc_owner_links.sql` (owner record links) and `20261016_kc_voices.sql` (whose voice is in each take; apply **before** deploying the code that uses it). Until that's applied, linking errors but everything else works.
2. Access is fixed in code: only matt@, penny@ and craig@highdesertpm.com (`allowedEmails` on the `knowledge_capture` section). User settings shows it locked; to add someone, edit that list. What they capture is readable by anyone using the brain (Dez, agents), at `internal` sensitivity.
6. Apply `20261025_kc_quick_capture.sql` for quick capture (untagged takes). Until then quick captures stay on the device and retry.
5. Apply `20261024_fee_risk_notes.sql` for fee change risk notes. Until then the list shows but notes can't be saved.
4. Also apply `20261018_harden_table_grants.sql` (sets the audio bucket's 25 MB / audio-only limit, among other hardening).
3. Production already has the env vars this needs: `OPENAI_API_KEY` (brain embeddings) and `ANTHROPIC_API_KEY` (brain think).

## Not yet

- Editing the profile directly. Correct the transcript instead, or record a correction take; the profile prefers newer notes and flags disagreements.
- Unit-level subjects and vendor profiles.
- Attaching several voice memos at once; suggesting the subject for a quick capture from its transcript.
- Background upload on iPhone (Safari has no Background Sync); the app must be open.
