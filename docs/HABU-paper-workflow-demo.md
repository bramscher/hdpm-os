# HABU paper workflow demo

The second demo is at `/admin/habu-paper`, under **Admin → Paper Workflows**. It preserves the full paper form while showing each person's assigned sections in **My work**. The original subway demo remains at `/admin/habu-demo`; `feature/habu-demo` preserves that original implementation.

## Access and data

The page and navigation require Craig's `craig@highdesertpm.com` account with admin access, using the same server-side guard as the original demo. The original PDF links reuse the guarded PDF endpoints. The **Preview as** selector changes a fictional participant inside the demo; it does not change the authenticated account or grant staff access.

All cases and participants are fictional. State lives only in the open page and resets on refresh. No messages, AppFolio writes, uploads, or durable records are created. Completion actions use the device clock and show Pacific time. This is a demonstration of proposed workflow rules, not a production workflow engine or audit log.

## Five-minute walkthrough

1. The demo starts as Sam, with the Owner section highlighted on gold sheet **VT-104**. Review the values, then choose **Hand off to Jordan**. The handoff stamps Sam and the time.
2. Choose **Preview Jordan's inbox** in the receipt. Advertising is now Ready. Open it to return to the same full sheet, with Advertising highlighted. Completed work has left Sam's Ready list.
3. Complete a checkbox to record a person and time. Use **N/A** with a reason where appropriate. **Undo** works before releasing the assignment, and keeps the correction in History. Required fields and unfinished checks prevent handoff.
4. Preview Alex and open **Waiting** to see the pending keys for VT-104 and their follow-up date. **People** lets Alex, the workflow owner, change a named assignment. That change is reflected in the recipient's inbox.
5. Preview Taylor. Open the turn-work assignment for **VT-105**. Its back contains two sample work orders. Both must be completed before handing off verification to Sam. Accounting remains independently on hold.
6. Open **All sheets → NT-202** to see the full New Tenant Set-up Form. It has separate setup, move-in, and after-move-in areas. Move-in releases parallel payment and filing assignments.
7. **Back → Folder contents** also lists the related paperwork in approximate process order. **Route** explains the dependencies, **History** shows demo actions, and **Print sheet** includes the front and back.

## Sources and interpretation

The original `AF - Vacancy Tracking-Gold In House Form.pdf` and `AF - New Tenant Set-up Form.pdf` supply the front layouts, labels, and mixed field types. Dates, monetary amounts, key counts, and choices remain fields; task checkmarks receive completion stamps. The user's description of handwritten work orders on the back supplies the proposed back-of-sheet workspace.

The additional office-wall photos supplied September 10, 2026 (`IMG_1811.JPG`, `IMG_1812.JPG`, `IMG_1813.JPG`) establish that these are document packets, not isolated checklists:

- Tenant setup includes a RentZap application summary, New Tenant Set-up Form, tenant information forms, deposit-to-hold paperwork, introductory and appointment letters, a tenant checklist, and a move-in condition/inspection form.
- Co-Tenant Set-up and Acquired Tenant Set-up are distinct forms and should become separate workflow templates, sharing common fields where appropriate.
- Vacancy paperwork includes a tenant notice to vacate, the gold tracking sheet, and a confirmation letter. The tracking sheet carries dates, initials, amounts, and handwritten annotations.
- The move-in condition form identifies itself as separate from a repair request. Future intake must preserve that distinction instead of automatically treating every condition entry as a work order.

These observations are reflected in a related-paperwork reference list on the back. The source images and their personal information are not included in the repository, demo data, or public assets. The list does not pretend to contain uploaded files or completed documents. Stage labels and routing rules are proposals: the photographs establish rough order and document relationships, not definitive assignees, dependency rules, or a legal interpretation of the letters. The layout order does not force every section into a single serial chain.

## Next adoption phases

1. Review the two sample master sheets and inbox handoffs with staff. Confirm actual owners, substitutes, required fields, waiting reasons, and where parallel work is allowed.
2. Pilot one workflow with durable shared storage, authenticated actors, server timestamps, transactional handoffs, immutable action history, and document links to their existing system. Add due-date editing and a defined correction/reopening process. Preserve document versions and prevent duplicate release under concurrent edits.
3. Add the co-tenant and acquired-tenant variants. Populate shared property/household fields once. Keep the original named forms recognizable and link every assignment to its master sheet.
4. Add selected AppFolio integrations and optional notification links after the pilot. Keep the process inbox authoritative; email or Slack should point to it rather than create separate copies of the work.

## Validation

`npm test -- lib/__tests__/habu-paper.test.ts lib/__tests__/habu-demo-access.test.ts` checks the workflow state transitions, owner restrictions, completion stamps and corrections, N/A reasons, prerequisites, waiting, reassignment, independent branches, required work orders, Pacific business dates, and both owner-only routes/PDF access.

`npm run build -- --webpack` checks the production build and TypeScript integration. A local component preview was checked in the browser: full-sheet layout, handoff receipt, recipient inbox, and scrolling/focus back to the assigned section. This preview omits the app shell; the authenticated live deployment still needs its own smoke check.
