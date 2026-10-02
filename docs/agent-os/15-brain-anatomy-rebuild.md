---
ontology: true
type: brief
domain: brain-map
status: draft
summary: Rebuild /brain from a ring "galaxy" into an anatomical brain, with one lobe per layer, density-scaled dots, a skull and an explode slider
tags: [brain-map, workstream-d, three-js, visualization, snapshot]
related: [10-restart-2026-08-20, 00-DRAFT-master-plan]
discovered: 2026-10-01
---

# Brain map: anatomy rebuild (brief)

Date: October 1, 2026. Status: brief, not started. Owner: Craig.

Mockup (sample data, approved look): https://claude.ai/artifact/N3zSnMt8aksSveRDrnSmke

## Why

The `/brain` map works but reads as an abstract galaxy of rings. Craig wants it to look like a brain. Each layer of the map should sit in a recognisable region, so that people can see how the company brain is organised: where policies live, where memory lives, and what runs on its own. The mockup confirmed the mapping makes sense.

This is workstream D under the Loop 1 gate extension (gate moved to Oct 15). It is not gate-critical. If chase board or parts-order work (A/B) needs the time, this waits.

## What the user sees

| Region | Layer it holds | Notes |
|---|---|---|
| Frontal lobe | Core: policies & processes | Policy docs, brain policies, brain processes |
| Parietal & motor | Skills: SOPs & procedures | Notion SOPs, OneDrive procedures, Loom videos |
| Temporal lobe | Memory: law & company memory | ORS 90, company memory |
| Occipital lobe | Vision (reserved) | Drawn faintly, labelled "reserved"; no sources yet |
| Cerebellum | Routines | Coloured by last-run status, as today |
| Brainstem | Integrations | AppFolio, Microsoft 365, Notion, Slack, Zoom, QuickBooks, Haven |
| Thalamus (centre) | Dez | The existing centre mesh moves here; Ask beams start here |

Decisions Craig made on the mockup:

1. **Regions keep their anatomical proportions.** They don't grow to fit their document count. As a region fills up, its dots get smaller. Dot size follows the average spacing between documents (cube root of region volume per document). The sparsest region gets the largest dots. Citation heat still adds size on top.
2. **Region labels are faint** (about one-third opacity) so they don't sit in front of the brain. The label of a focused region becomes fully bright.
3. **A skull shell** of faint dots, open at the base, surrounds the brain. Exploding lifts it off and fades it out. A button hides it.
4. **Explode slider** from "Whole" to "Apart". Lobes move outward from the centre, the hemispheres separate, and links between lobes stretch so you can see what connects them.
5. Crowding in the Memory lobe is acceptable. It shows where most of the knowledge is.

The current page keeps everything it already does: title and meaning search, Ask with lit sources and beams, sector filter chips, the node detail panel with neighbours, and the hover tooltip.

## How it's built

### 1. Shared geometry: `lib/brain/anatomy.ts` (new, pure)

- One module defines the brain volume, and both the server and the browser import it. It holds the same signed-volume functions as the mockup: a cerebrum with a flat medial face, a temporal bulge, the cerebellum and the brainstem. It also holds the fissure planes that split the cerebrum into frontal, parietal, temporal and occipital regions.
- It exports `unitAt(x, y, z)`, which returns a region and hemisphere (or nothing). It also exports `regionVolume(region)`, the region's precomputed relative volume, and `sampleShell(seed)`, the cortex surface points with gyri and folia patterns.
- It has no three.js import, so it unit-tests in Node.
- The cortex shell is generated in the browser from this module, not shipped in the snapshot JSON. That keeps about 10k points out of the nightly file.

### 2. Server layout: `lib/brain/viz.ts`

- Replace `layoutRing` with `layoutRegion`. `LAYERS` gets a `region` field, and `radius`/`band` go away.
- **Each node's position is independent of the others.** That keeps the nightly map from reshuffling, as today.
  - A sector's centre is a deterministic point inside its region, chosen by hashing the sector name against the region's samples.
  - A node's position is the sector centre plus hash-seeded Gaussian jitter, retried with new salts until `unitAt` lands in the right region.
  - Adding a document never moves the existing ones.
- **Hemisphere:** a sector goes to the left or right half by hashing its name. Sectors with more than 150 docs split across both halves by node id. (See open question 1.)
- Bump the snapshot to `version: 2`:
  - Each `VizNode` gains `region` and `hemi`.
  - The snapshot gains `regions: { key, label, layer, count, dotScale, units: { hemi, centroid, explodeDir }[] }[]`.
  - `dotScale` is the density rule from decision 1, computed here so the client only renders.
- Edges, kNN, heat, routines and integrations are unchanged.

### 3. Scene: `components/brain/BrainScene.tsx`

- Keep plain three.js, the InstancedMesh for nodes, OrbitControls and the bloom pass. The no react-three-fiber decision stands.
- **New objects:**
  - Cortex shell points, from `sampleShell`, with additive blending and low intensity.
  - Skull points.
  - Faint region labels in the HTML overlay.
- **Explode:** each region-hemisphere unit gets an offset of `explodeDir × t`. While the slider animates, the scene updates instance matrices and edge and beam positions. With about 2k nodes and 6k edges, CPU updates only during the animation are fine. Move this to a shader uniform only if profiling says so.
- **Region focus:** clicking a region in the legend or in the brain dims everything else. This reuses the existing `visible` set by building it from the region.
- **Bloom:** the shell and skull must not wash out under bloom. Either render them on a layer that skips the bloom pass, or keep their colours below the bloom threshold (0.6). Tune this on real data.
- `nodeScale()` uses `region.dotScale` for documents. Routines and integrations keep their fixed sizes.

### 4. Page chrome: `components/brain/BrainMap.tsx`

- Add a region legend with counts. Each entry focuses its region on click.
- Add the explode slider, the skull toggle, and the view presets (Angled / Side / Top / Back) beside the existing controls.
- Sector chips stay, grouped under their region.
- If a version-1 snapshot is loaded, show "The brain map is being rebuilt. It will appear after the next nightly snapshot." instead of crashing.

### 5. Tests: `lib/brain/__tests__/viz.test.ts` and a new `anatomy.test.ts`

- Every region has non-zero volume, and `unitAt` gives each region one consistent answer (no gaps or overlaps at the sample points).
- Every node lands inside its own region: `unitAt(pos)` matches the node's `region` and `hemi`.
- Layout is deterministic, and adding a document leaves the other nodes' positions unchanged.
- `dotScale` shrinks as a region's count rises, and the sparsest region gets the largest dots.
- The existing tests for classification, edges, heat and stats keep passing.

### No database, migration or access changes

The snapshot RPC and storage path stay the same. `/brain` is already registered in `lib/access/sections.ts` (`brain`).

## Rollout

1. Open one PR (workstream D, one session). Check it with `npm test`, a typecheck, and a look at `/brain` locally against a locally built snapshot.
2. After merging, trigger the snapshot cron once in production (`/api/brain/cron/snapshot` with the cron bearer) so a version-2 snapshot replaces the old one right away. Check the logs with `vercel logs --project hdpm-chatbot --scope bramplan --environment production --query brain-viz`.
3. Check it on a phone. The whole brain should fit at portrait width, as the mockup's wider camera angle does.

## Out of scope

- A mini-map showing the focused region (a later idea, if faint labels still feel busy)
- Sources for the vision lobe (inspection photos are a candidate later)
- A realistic, segmented brain mesh instead of the procedural shapes
- Always-on Dez citation beams (the mockup shows them; the real page keeps beams for Ask results only unless Craig says otherwise)

## Open questions for Craig

1. **Should left and right halves mean something?** The default above splits by sector so both halves fill evenly. One alternative: left = imported knowledge (Notion, OneDrive, ORS), right = company memory Dez has written. That would make the two halves tell a story but leave them unevenly filled.
2. **Always-on citation beams?** The mockup draws pulsing lines from Dez to the most-cited documents. Should they show at rest, or only during Ask as today?
3. **Default view:** should the page open with the brain whole (skull on) or slightly exploded so the lobes read immediately?
