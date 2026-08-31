> **STATUS: HISTORICAL / exploration (not built).** A concept demo built for the 7/22/2026 team meeting; there is no `/demo` route in the app. Kept as a point-in-time artifact — do not read as current state. See `docs/README.md`.

# Demo Site Integration — Session Brief

**Created 7/22/2026.** This folder holds the HDPM-OS concept demo: 9 self-contained
HTML pages (inline CSS/JS/SVG, zero external assets, relative links, `index.html`
is home). It was built for the 7/22 team meeting and demos where the forms /
Jackets / agents work is going. Content uses sample data but real staff first
names and vendor names — **internal only, must sit behind staff auth.**

## Goal (one wave, plan mode first — per CLAUDE.md)

Serve this folder at **`/demo`** inside hdpm-chat, behind the existing staff
session, and add one "Demo" link where staff will find it (dashboard or nav).

## Constraints

1. **Do not edit the HTML files.** They are finished artifacts, regenerated
   outside the repo; treat as static assets. (Exception: if serving under
   `/demo/` breaks the relative links to `00-START-HERE.html` etc., fixing
   hrefs/paths minimally is fine — verify every nav link after.)
2. **Auth first.** Check `middleware.ts` before choosing an approach:
   - If `public/` assets bypass the auth middleware (typical Next.js), do NOT
     just drop these in `public/demo/`. Prefer a route handler (e.g.
     `app/demo/[[...path]]/route.ts`) that reads from this folder (or from
     `private/demo-site/`) and requires the same session as other staff pages —
     mirror however `app/keys` or `app/maintenance` gate access.
   - If middleware already protects everything including static paths, `public/
     demo/` is acceptable — verify by curling a page logged-out.
3. Correct `Content-Type: text/html` and no caching surprises during iteration.
4. No search-engine exposure: the app is internal, but add
   `X-Robots-Tag: noindex` on `/demo/*` anyway.
5. Zero impact on existing routes, maintenance-os work, or the build. No new
   dependencies.

## Verify (definition of done)

- Logged out → `/demo` redirects to login (or 401s). Logged in → `/demo` shows
  the home page and **every nav-bar link works** (Inventory, Turnover Board,
  Jackets UI, Agents, Home Concepts, Concept Doc, Board Plan, and back Home).
- Interactive bits function: tab switching on Jackets UI, the Bump demo (tab C),
  Gantt zoom (tab D), desk switcher (tab E), map/HUD toggle on Home Concepts.
- `npm run build` passes.

## Out of scope (do not do now)

- Rewriting these pages as React components (that happens per-view when each
  concept graduates to a real feature — tracked elsewhere).
- Wiring any page to live data.
- Public/external access of any kind.
