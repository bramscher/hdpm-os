---
type: plan
status: active
tags: [hdpm-os, parts-orders, chase-board, loop-1, review-checklist, pr-90]
relatedTo: [docs/agent-os/10-restart-2026-08-20.md]
---

# Parts orders — morning review (PR #90)

The migration has been run, the preview deployed, and all checks passed. This review takes about 15 minutes. **The preview uses the production database**, so use the real Lowe's dishwasher work order instead of a fake one.

- **PR:** https://github.com/bramscher/hdpm-os/pull/90
- **Preview:** https://hdpm-chatbot-git-feature-parts-orders-bramplan.vercel.app

## Before you start

Have these ready:
- [ ] The WO number for the Lowe's dishwasher job
- [ ] Lowe's order #, PO, ordered date and promised delivery date (Cheryl will know)
- [ ] Lowe's Bend Pro desk phone number and email, if you have them
- [ ] Roughly how many minutes Cheryl spent chasing it

## 1. Log the order (work order page)

1. On the preview, open the dishwasher work order (Maintenance → Board → the WO).
2. Find the **Parts orders** panel and open **Add parts order**.
3. Fill it in:
   - Supplier: **Lowe's (Bend Pro desk)**
   - Item: the dishwasher model
   - Order # and PO
   - Ordered date and expected delivery date
   - Notes, e.g. "Cheryl chased 9/30, order had gone missing"
4. Click **Save parts order**.

**Check:**
- [ ] A green message says the order is saved, and the order shows with status ORDERED
- [ ] The stage at the top now reads **WAITING ON / PARTS**
- [ ] If you saw "Order saved, but the work order stage wasn't changed…", write down the message

## 2. See it on the chase board

Open `/maintenance/estimate-followups`.

**If the expected date has already passed** (by more than 1 business day):
- [ ] The WO is in the **Waiting on parts** lane, and nowhere else (not Needs scheduling or Vendor estimate)
- [ ] The card's next step reads like "Email Lowe's (Bend Pro desk) about order #… — expected … and not delivered"
- [ ] It's eligible for **Do these first** at the top. That list holds 7, so a long-stuck item from another lane may outrank it

**If the expected date hasn't passed yet:**
- [ ] The WO is in the **Waiting on replies** tray at the bottom, labeled "Parts · due for a check {date}"

Either way:
- [ ] The **Waiting on parts** row shows up in the aging snapshot at the top

## 3. Record Cheryl's chase (drawer)

1. Click the card, or the row in the tray, to open the drawer.
2. Under **Parts orders**, choose **Call**, enter Cheryl's minutes, and add a note ("Cheryl: order lost, Lowe's re-placed it", or whatever happened).
3. Click **Record call**.

**Check:**
- [ ] The order shows "1 contact, N min spent"
- [ ] **History** lists the call with its minutes
- [ ] Back on the board, one chase dot is filled on the card

## 4. Supplier contact info

The seeded suppliers have no phone or email.

- [ ] If the card says "Add a phone or email for Lowe's…", that's expected for now. There's no screen to add supplier contacts yet; tell Claude the number and email and it'll add them. (A small supplier edit screen is a good follow-up.)
- [ ] Once Lowe's has an email, the drawer's **Write the follow-up** box pre-fills a message that quotes the order #, PO, item and expected date, with no dollar amounts.
  - Don't send it unless you mean to. Sending is still off in preview mode, so a send should be blocked with "Preview mode".

## 5. Quick edge checks (optional)

- [ ] Change the order's **Status** to *shipped*. The history logs "Status ordered → shipped".
- [ ] Change the expected date and click **Save**. The history logs it.
- [ ] Set status to *issue*. The card moves to **Needs help**. Set it back afterwards.
- [ ] Use **Waiting on parts? Log the supplier order** in the drawer of a *different* card, but only on a WO that really is waiting on parts. That WO should move into the parts lane.

## 6. Decide

- **All good:** merge PR #90, or tell Claude "merge it". The order you logged on the preview is already in production data.
- **Something's off:** tell Claude the step number and what you saw.

## Reference: when an order comes due for a chase

| Order state | Due when |
|---|---|
| Ordered/shipped, with an expected date | More than 1 business day past expected (expected Fri → due Tue) |
| Ordered/shipped, no expected date | More than 5 business days since ordering |
| Delivered, WO has no service date | More than 2 business days since delivery |
| Issue | Immediately, and moves to Needs help |
| 3+ calls/emails/texts | Moves to Needs help |
| Installed / cancelled | Never; drops off the board |
