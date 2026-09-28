/**
 * The Desk demo — story data. Each story follows one folder across desks
 * using a routing template from lib/habu-paper/model.ts and the real form
 * titles transcribed in lib/habu-paper/form-drafts.ts. Sample people,
 * properties and amounts only.
 */

import { TEMPLATES, type Assignment } from "@/lib/habu-paper/model";

export type Person = "Ashley" | "Kennedy" | "Cheryl" | "Penny";
export type DocStage = "none" | "prefilled" | "printed" | "scanned" | "filed";
export type ModalKind = "print" | "scan" | "file";

export interface Doc {
  id: string;
  title: string;
  record: "Tenant" | "Property" | "Owner";
  stage: DocStage;
  note?: string;
}

export interface State {
  holder: Person | "Filed";
  tray: "in" | "waiting";
  waitingOn?: string;
  stepLabel: string;
  daysOnDesk: number;
  done: string[]; // routing assignment ids signed off
  docs: Doc[];
  workOrders: { text: string; done: boolean }[];
  history: { who: string; text: string }[];
  passed: { from: Person; to: Person | "Filed"; what: string }[];
}

export interface StoryStep {
  action: string;
  who: Person;
  title: string;
  realWorld: string;
  inApp: string;
  button: string;
  /** Opens a preview first (print / scan / file); otherwise the step applies directly. */
  modal?: { kind: ModalKind; docId?: string };
  apply: (s: State) => State;
}

/** What a printed page shows: typed prefill rows, blank lines for the pen, and what the pen wrote (for scans). */
export interface PaperDef {
  title: string;
  code: string;
  typed: [string, string][];
  blanks: string[];
  hand: Record<string, string>;
  /** Other forms printed or scanned with this one. */
  with?: string;
  /** Shown after a scan is QR-matched. */
  scanNote?: string;
}

export interface StoryDef {
  key: "gold" | "green" | "blue";
  label: string;
  /** "How this folder moves": the modeled HABU routing, or a draft for folders not modeled yet. */
  routing: { title: string; assignments: Assignment[]; draft?: boolean };
  folder: { id: string; color: "gold" | "green" | "blue"; kindLabel: string; address: string; city: string; tenant?: string; owner?: string };
  initial: State;
  steps: StoryStep[];
  paper: Record<string, PaperDef>;
  /** Key details shown on the back tab. */
  details: (s: State) => [string, string][];
  closing: string;
}

export const setDoc = (s: State, id: string, stage: DocStage): Doc[] => s.docs.map((d) => (d.id === id ? { ...d, stage } : d));
const setDocs = (s: State, ids: string[], stage: DocStage): Doc[] => s.docs.map((d) => (ids.includes(d.id) ? { ...d, stage } : d));
const note = (s: State, who: string, text: string) => [...s.history, { who, text }];
export const pass = (s: State, from: Person, to: Person, what: string, stepLabel: string): State => ({
  ...s,
  holder: to,
  tray: "in",
  waitingOn: undefined,
  stepLabel,
  daysOnDesk: 0,
  passed: [{ from, to, what }, ...s.passed],
  history: note(s, from, `Passed the folder to ${to}: ${what}.`),
});
const fileAll = (s: State, who: Person, id: string, n: number, records = "tenant and property"): State => ({
  ...s,
  holder: "Filed",
  docs: s.docs.map((d) => ({ ...d, stage: "filed" })),
  passed: [{ from: who, to: "Filed", what: "all documents filed in AppFolio" }, ...s.passed],
  history: note(s, who, `Filed ${n} documents to the ${records} records in AppFolio. Folder ${id} closed.`),
});

// ── Gold: vacancy ─────────────────────────────────────────

const GOLD: StoryDef = {
  key: "gold",
  label: "Gold folder · Vacancy",
  routing: TEMPLATES.vacancy,
  folder: { id: "VT-118", color: "gold", kindLabel: "Vacancy", address: "1420 NW Elm Ave #B", city: "Bend", tenant: "J. Rivera" },
  initial: {
    holder: "Ashley",
    tray: "in",
    stepLabel: "Prepare and submit notice",
    daysOnDesk: 0,
    done: [],
    docs: [
      { id: "notice", title: "Tenant’s 30 Day Notice to Vacate", record: "Tenant", stage: "scanned", note: "Arrived by email: already a scan" },
      { id: "confirm", title: "Confirmation of 30 Day Notice to Vacate", record: "Tenant", stage: "none" },
      { id: "tracking", title: "Vacancy Tracking (gold sheet)", record: "Property", stage: "none", note: "Master sheet that rides in the folder" },
      { id: "inspection", title: "Move-out inspection", record: "Tenant", stage: "none" },
      { id: "accounting", title: "Final accounting & deposit statement", record: "Tenant", stage: "none" },
    ],
    workOrders: [],
    history: [{ who: "Ashley", text: "30-day notice received for 1420 NW Elm Ave #B. Gold folder VT-118 started." }],
    passed: [],
  },
  steps: [
    {
      action: "print-front",
      who: "Ashley",
      title: "A 30-day notice to vacate arrives",
      realWorld: "Ashley pulls a gold folder, fills in the tracking sheet by hand and types a confirmation letter.",
      inApp: "The gold folder is already on her desk. One click prefills the Vacancy Tracking sheet and the Confirmation of 30 Day Notice with the tenant, unit, owner and dates, then prints them with a QR code in the corner.",
      button: "Prefill & print both forms",
      modal: { kind: "print", docId: "tracking" },
      apply: (s) => ({ ...s, docs: setDocs(s, ["tracking", "confirm"], "printed"), history: note(s, "Ashley", "Prefilled and printed the Vacancy Tracking sheet and the notice confirmation (QR stamped).") }),
    },
    {
      action: "pass-kennedy",
      who: "Ashley",
      title: "Hand the folder to the property manager",
      realWorld: "The folder goes on Kennedy’s desk. Nobody else knows where it is.",
      inApp: "“Pass to Kennedy” signs off Ashley’s step. The folder lands on top of Kennedy’s In tray, and Ashley can see it in Passed on.",
      button: "Pass to Kennedy",
      apply: (s) => ({ ...pass(s, "Ashley", "Kennedy", "confirm owner and listing", "Confirm owner and listing details"), done: [...s.done, "notice"] }),
    },
    {
      action: "email-owner",
      who: "Kennedy",
      title: "Waiting on the owner",
      realWorld: "Kennedy emails the owner and the folder sits in a pile until they reply.",
      inApp: "The folder moves to Kennedy’s Waiting on tray with a follow-up date, so it can’t get buried.",
      button: "Emailed owner: wait for reply",
      apply: (s) => ({ ...s, tray: "waiting", waitingOn: "Owner approval · follow up Thu", history: note(s, "Kennedy", "Emailed the owner for approval to list. Follow up Thursday.") }),
    },
    {
      action: "owner-replied",
      who: "Kennedy",
      title: "The owner replies",
      realWorld: "Kennedy digs the folder back out of the stack.",
      inApp: "One click puts it back in the In tray. Owner and listing are signed off, and the keys come back.",
      button: "Owner approved: back to In",
      apply: (s) => ({ ...s, tray: "in", waitingOn: undefined, stepLabel: "Inspect the unit", done: [...s.done, "owner", "advertising", "keys"], history: note(s, "Kennedy", "Owner approved listing at $1,895. Keys returned and receipted.") }),
    },
    {
      action: "print-inspection",
      who: "Kennedy",
      title: "Print the move-out inspection",
      realWorld: "Kennedy prints a blank inspection form and writes the address and names by hand.",
      inApp: "The inspection form prints already filled in with the unit, tenant, move-out date and the move-in condition notes. Kennedy only writes what she finds.",
      button: "Prefill & print inspection",
      modal: { kind: "print", docId: "inspection" },
      apply: (s) => ({ ...s, docs: setDoc(s, "inspection", "printed"), history: note(s, "Kennedy", "Printed the prefilled move-out inspection (QR stamped).") }),
    },
    {
      action: "scan-inspection",
      who: "Kennedy",
      title: "Scan the hand-written inspection back",
      realWorld: "The written form goes back in the folder and might get scanned weeks later, into the wrong record.",
      inApp: "Kennedy scans it. The QR code tells the app which folder and form it is, and the three repairs she wrote down become work orders on the back of the folder.",
      button: "Scan back inspection",
      modal: { kind: "scan", docId: "inspection" },
      apply: (s) => ({
        ...s,
        docs: setDoc(s, "inspection", "scanned"),
        done: [...s.done, "inspection"],
        workOrders: [
          { text: "Patch and paint hallway wall", done: false },
          { text: "Replace bathroom fan cover", done: false },
          { text: "Deep clean carpet, back bedroom", done: false },
        ],
        history: note(s, "Kennedy", "Scanned the inspection back (QR matched VT-118 · Move-out inspection v1). 3 turn work orders added."),
      }),
    },
    {
      action: "pass-cheryl",
      who: "Kennedy",
      title: "Send it to maintenance",
      realWorld: "The folder is walked over to Cheryl.",
      inApp: "“Pass to Cheryl” puts it on her desk with the work orders on the back.",
      button: "Pass to Cheryl",
      apply: (s) => pass(s, "Kennedy", "Cheryl", "complete turn work orders", "Complete turn work orders"),
    },
    {
      action: "complete-wos",
      who: "Cheryl",
      title: "Turn work gets done",
      realWorld: "Cheryl ticks the work orders on the paper as the crew finishes.",
      inApp: "She checks them off on the folder. The app won’t let the folder move on while any are open.",
      button: "Complete all 3 work orders",
      apply: (s) => ({ ...s, workOrders: s.workOrders.map((w) => ({ ...w, done: true })), done: [...s.done, "turn-work"], history: note(s, "Cheryl", "Completed all 3 turn work orders.") }),
    },
    {
      action: "pass-verify",
      who: "Cheryl",
      title: "Back to the property manager to verify",
      realWorld: "Cheryl tells Kennedy the unit is ready, or forgets to.",
      inApp: "“Pass to Kennedy” returns it for the final walk-through.",
      button: "Pass to Kennedy",
      apply: (s) => pass(s, "Cheryl", "Kennedy", "verify unit readiness", "Verify unit readiness"),
    },
    {
      action: "verify-pass-penny",
      who: "Kennedy",
      title: "Verified: on to accounting",
      realWorld: "Kennedy signs the sheet and drops the folder in Penny’s basket.",
      inApp: "Kennedy signs off the unit as ready and passes the folder to Penny for the final accounting.",
      button: "Verify & pass to Penny",
      apply: (s) => ({ ...pass(s, "Kennedy", "Penny", "complete tenant accounting", "Complete tenant accounting"), done: [...s.done, "verify"] }),
    },
    {
      action: "closeout",
      who: "Penny",
      title: "Close out the tenant",
      realWorld: "Penny writes up the deposit statement and scans the stack when she has time.",
      inApp: "The deposit statement is generated from the ledger. Penny scans the Vacancy Tracking sheet and the notice confirmation back, and the QR codes match them to this folder.",
      button: "Finish accounting & scan back",
      modal: { kind: "scan", docId: "tracking" },
      apply: (s) => ({
        ...s,
        done: [...s.done, "closeout"],
        docs: s.docs.map((d) => (d.id === "accounting" ? { ...d, stage: "prefilled" } : d.id === "tracking" || d.id === "confirm" ? { ...d, stage: "scanned" } : d)),
        history: note(s, "Penny", "Deposit statement generated. Vacancy Tracking sheet and notice confirmation scanned back (QR matched)."),
      }),
    },
    {
      action: "file",
      who: "Penny",
      title: "File everything in AppFolio and close the folder",
      realWorld: "Someone eventually uploads the scans, if they remember and pick the right record.",
      inApp: "Every document files to the right AppFolio record with a standard file name. The folder closes only when all of them show as filed.",
      button: "File all to AppFolio & close",
      modal: { kind: "file" },
      apply: (s) => fileAll(s, "Penny", "VT-118", 5),
    },
  ],
  paper: {
    tracking: {
      title: "Vacancy Tracking",
      code: "TRACK",
      typed: [["Property", "1420 NW Elm Ave #B, Bend"], ["Tenant", "J. Rivera"], ["Notice received", "Sep 29, 2026"], ["Move-out date", "Oct 15, 2026"], ["Owner", "Pine Ridge Holdings LLC"]],
      blanks: ["Keys returned", "Listing rent", "Inspection date", "Notes"],
      hand: { "Keys returned": "2 keys + fob  ✓", "Listing rent": "$1,895", "Inspection date": "10/16", Notes: "owner ok'd paint" },
      with: "The Confirmation of 30 Day Notice to Vacate prints with it.",
      scanNote: "The notice confirmation was scanned in the same batch and matched too.",
    },
    inspection: {
      title: "Move-out Inspection",
      code: "INSP",
      typed: [["Property", "1420 NW Elm Ave #B, Bend"], ["Tenant", "J. Rivera"], ["Move-out date", "Oct 15, 2026"], ["Move-in notes", "Minor wear, living room carpet (2023)"]],
      blanks: ["Walls & paint", "Bathroom", "Carpet / flooring", "Appliances", "Inspector signature"],
      hand: { "Walls & paint": "hallway wall gouge: patch + paint", Bathroom: "fan cover cracked", "Carpet / flooring": "back bedroom stains: deep clean", Appliances: "ok", "Inspector signature": "K. —" },
      scanNote: "3 repairs noted on the page. Confirm and they become work orders on the back of the folder.",
    },
  },
  details: (s) => [
    ["Tenant", "J. Rivera (sample)"],
    ["Move-out", "Oct 15"],
    ["Owner", "Pine Ridge Holdings LLC (sample)"],
    ["Listing rent", s.done.includes("owner") ? "$1,895" : "(pending owner)"],
    ["Keys", s.done.includes("keys") ? "2 keys, 1 fob: receipted" : "(not returned)"],
    ["Deposit", "$1,800"],
  ],
  closing: "Folder VT-118 is closed: every step signed off, every document filed.",
};

// ── Green: new tenant setup ───────────────────────────────

const GREEN: StoryDef = {
  key: "green",
  label: "Green folder · New tenant setup",
  routing: TEMPLATES.setup,
  folder: { id: "NT-219", color: "green", kindLabel: "New tenant setup", address: "88 NW Hill St #2", city: "Bend", tenant: "M. Chen" },
  initial: {
    holder: "Ashley",
    tray: "in",
    stepLabel: "Prepare tenant set-up",
    daysOnDesk: 0,
    done: [],
    docs: [
      { id: "application", title: "Application Summary (RentZap)", record: "Tenant", stage: "scanned", note: "Came from RentZap as a PDF: already digital" },
      { id: "setup", title: "New Tenant Set-up Form (green sheet)", record: "Tenant", stage: "none", note: "Master sheet that rides in the folder" },
      { id: "info", title: "New Tenant Information Form", record: "Tenant", stage: "none" },
      { id: "dth", title: "Deposit to Hold Agreement", record: "Tenant", stage: "none", note: "Tenant signs; the AppFolio Form Filler can fill it" },
      { id: "welcome", title: "Deposit to Hold / Welcome Letter", record: "Tenant", stage: "none" },
      { id: "moveinletter", title: "Move-in Appointment Letter", record: "Tenant", stage: "none" },
      { id: "checklist", title: "New Tenant’s Checklist", record: "Tenant", stage: "none", note: "Signed at move-in" },
      { id: "inspection", title: "New Tenant Inspection Form", record: "Property", stage: "none", note: "Tenant records move-in condition" },
    ],
    workOrders: [],
    history: [{ who: "Ashley", text: "Application approved for 88 NW Hill St #2 (M. Chen). Green folder NT-219 started." }],
    passed: [],
  },
  steps: [
    {
      action: "print-packet",
      who: "Ashley",
      title: "An application is approved",
      realWorld: "Ashley pulls a green folder and fills in the set-up sheet, the Deposit to Hold agreement and the welcome letter by hand, copying the same names, rent and deposit onto each.",
      inApp: "The green folder is on her desk with the RentZap summary inside. One click prefills the set-up sheet, Deposit to Hold agreement, welcome letter and tenant information form from the application, so the details are typed once.",
      button: "Prefill & print the setup packet",
      modal: { kind: "print", docId: "dth" },
      apply: (s) => ({
        ...s,
        docs: setDocs(s, ["setup", "info", "dth"], "printed").map((d) => (d.id === "welcome" ? { ...d, stage: "prefilled" } : d)),
        history: note(s, "Ashley", "Prefilled and printed the set-up sheet, Deposit to Hold agreement and tenant information form (QR stamped). Welcome letter emailed."),
      }),
    },
    {
      action: "scan-dth",
      who: "Ashley",
      title: "The applicant signs and returns the paperwork",
      realWorld: "The signed agreement goes in the folder; someone scans it later and hopes it lands in the right tenant.",
      inApp: "Ashley scans the signed Deposit to Hold and the completed information form. The QR codes match both to NT-219.",
      button: "Scan back signed forms",
      modal: { kind: "scan", docId: "dth" },
      apply: (s) => ({ ...s, docs: setDocs(s, ["dth", "info"], "scanned"), done: [...s.done, "intake"], history: note(s, "Ashley", "Scanned the signed Deposit to Hold and tenant information form (QR matched NT-219).") }),
    },
    {
      action: "pass-penny",
      who: "Ashley",
      title: "Accounting confirms the deposit",
      realWorld: "Ashley walks the folder to Penny and asks whether the deposit cleared.",
      inApp: "“Pass to Penny” puts it on her desk with the amount due already on the sheet.",
      button: "Pass to Penny",
      apply: (s) => pass(s, "Ashley", "Penny", "confirm the deposit to hold", "Confirm deposit handoff"),
    },
    {
      action: "funds-pass-kennedy",
      who: "Penny",
      title: "Deposit cleared: on to the property manager",
      realWorld: "Penny initials the sheet and sets the folder on Kennedy’s desk.",
      inApp: "Penny confirms the $1,800 deposit cleared, signs off her step, and passes the folder to Kennedy for the rental agreement.",
      button: "Deposit cleared: pass to Kennedy",
      apply: (s) => ({ ...pass(s, "Penny", "Kennedy", "prepare the agreement and move-in letters", "Prepare agreement and move-in letters"), done: [...s.done, "funds"] }),
    },
    {
      action: "print-movein",
      who: "Kennedy",
      title: "Prepare the lease and move-in paperwork",
      realWorld: "Kennedy types the move-in letter and prints a blank checklist and inspection form for move-in day.",
      inApp: "The rental agreement goes out for e-signature in AppFolio as today. The move-in letter, New Tenant’s Checklist and New Tenant Inspection Form print prefilled with the unit, date and amounts due.",
      button: "Prefill & print move-in paperwork",
      modal: { kind: "print", docId: "moveinletter" },
      apply: (s) => ({
        ...s,
        docs: setDocs(s, ["checklist", "inspection"], "printed").map((d) => (d.id === "moveinletter" ? { ...d, stage: "printed" } : d)),
        done: [...s.done, "lease"],
        history: note(s, "Kennedy", "Rental agreement sent for e-signature. Printed the move-in letter, checklist and inspection form (QR stamped)."),
      }),
    },
    {
      action: "pass-ashley",
      who: "Kennedy",
      title: "Back to the front desk for move-in",
      realWorld: "The folder goes back to Ashley’s basket.",
      inApp: "“Pass to Ashley” puts it on her desk with the move-in date showing.",
      button: "Pass to Ashley",
      apply: (s) => pass(s, "Kennedy", "Ashley", "complete move-in details", "Complete move-in details"),
    },
    {
      action: "wait-insurance",
      who: "Ashley",
      title: "Waiting on renter’s insurance",
      realWorld: "The folder sits until someone remembers to check for the insurance certificate.",
      inApp: "The folder moves to Ashley’s Waiting on tray with a follow-up date, so move-in can’t sneak past a missing requirement.",
      button: "Requested insurance: wait",
      apply: (s) => ({ ...s, tray: "waiting", waitingOn: "Renter’s insurance proof · follow up Wed", history: note(s, "Ashley", "Asked the tenant for proof of renter’s insurance. Follow up Wednesday.") }),
    },
    {
      action: "insurance-in",
      who: "Ashley",
      title: "Insurance arrives",
      realWorld: "Ashley finds the folder again when the certificate shows up.",
      inApp: "One click puts it back in the In tray, ready for move-in day.",
      button: "Insurance received: back to In",
      apply: (s) => ({ ...s, tray: "in", waitingOn: undefined, history: note(s, "Ashley", "Renter’s insurance certificate received. Utilities confirmed.") }),
    },
    {
      action: "scan-movein",
      who: "Ashley",
      title: "Move-in day",
      realWorld: "The tenant signs the checklist and fills in the inspection form; both go in a pile to scan.",
      inApp: "Ashley scans the signed checklist and the completed inspection form. The QR codes match them to NT-219, and the move-in step is signed off.",
      button: "Scan back move-in forms",
      modal: { kind: "scan", docId: "checklist" },
      apply: (s) => ({ ...s, docs: setDocs(s, ["checklist", "inspection"], "scanned"), done: [...s.done, "movein"], history: note(s, "Ashley", "Keys handed over. Scanned the signed checklist and move-in inspection (QR matched NT-219).") }),
    },
    {
      action: "pass-penny-payments",
      who: "Ashley",
      title: "Accounting turns on online payments",
      realWorld: "Ashley emails Penny to set up the tenant’s online payments.",
      inApp: "“Pass to Penny” sends the folder for online payments. Ashley’s filing step stays open in parallel.",
      button: "Pass to Penny",
      apply: (s) => pass(s, "Ashley", "Penny", "enable online payments", "Enable online payments"),
    },
    {
      action: "payments-pass-ashley",
      who: "Penny",
      title: "Payments on: back for filing",
      realWorld: "Penny sets up payments and returns the folder.",
      inApp: "Penny signs off online payments and passes the folder back to Ashley to finish the records.",
      button: "Payments enabled: pass to Ashley",
      apply: (s) => ({ ...pass(s, "Penny", "Ashley", "finish after-move-in records", "Finish after-move-in records"), done: [...s.done, "payments"] }),
    },
    {
      action: "file",
      who: "Ashley",
      title: "File everything in AppFolio and close the folder",
      realWorld: "Eight forms get uploaded one by one, if someone has time.",
      inApp: "All eight documents file to the tenant and property records with standard names. The folder closes only when every one shows as filed.",
      button: "File all to AppFolio & close",
      modal: { kind: "file" },
      apply: (s) => ({ ...fileAll(s, "Ashley", "NT-219", 8), done: [...s.done, "filing"] }),
    },
  ],
  paper: {
    dth: {
      title: "Deposit to Hold Agreement",
      code: "DTH",
      typed: [["Property", "88 NW Hill St #2, Bend"], ["Applicant", "M. Chen"], ["Monthly rent", "$1,650"], ["Deposit to hold", "$1,800"], ["Planned move-in", "Oct 20, 2026"]],
      blanks: ["Applicant signature", "Date", "Management signature"],
      hand: { "Applicant signature": "Mei Chen", Date: "9/30/26", "Management signature": "A. —" },
      with: "The New Tenant Set-up Form and New Tenant Information Form print with it; the welcome letter is emailed.",
      scanNote: "The completed New Tenant Information Form was in the same batch and matched too.",
    },
    moveinletter: {
      title: "Move-in Appointment Letter",
      code: "MOVEIN",
      typed: [["Property", "88 NW Hill St #2, Bend"], ["Tenant", "M. Chen"], ["Move-in date", "Oct 20, 2026 · 10:00 AM"], ["Due at move-in", "$1,650 first month (prorated $1,285)"], ["Bring", "Proof of renter’s insurance, utilities in your name"]],
      blanks: ["Confirmed by phone", "Notes"],
      hand: { "Confirmed by phone": "yes, 10/14", Notes: "wants 2 extra keys" },
      with: "The New Tenant’s Checklist and New Tenant Inspection Form print with it for move-in day.",
    },
    checklist: {
      title: "New Tenant’s Checklist",
      code: "CHECK",
      typed: [["Property", "88 NW Hill St #2, Bend"], ["Tenant", "M. Chen"], ["Move-in date", "Oct 20, 2026"]],
      blanks: ["Keys received", "Garage / mailbox", "Insurance on file", "Utilities transferred", "Tenant signature"],
      hand: { "Keys received": "3 door + 1 mail  ✓", "Garage / mailbox": "mailbox #2  ✓", "Insurance on file": "✓", "Utilities transferred": "PPL + city water  ✓", "Tenant signature": "Mei Chen" },
      scanNote: "The New Tenant Inspection Form was in the same batch and matched too.",
    },
  },
  details: () => [
    ["Tenant", "M. Chen (sample)"],
    ["Move-in", "Oct 20"],
    ["Rent", "$1,650 / mo"],
    ["Deposit to hold", "$1,800"],
    ["Owner", "Hill Street Rentals LLC (sample)"],
    ["Application", "Approved Sep 29 (RentZap)"],
  ],
  closing: "Folder NT-219 is closed: tenant moved in, every step signed off, all eight documents filed.",
};

// ── Blue: owner onboarding ────────────────────────────────
// Documents follow HDPM's Owner Information Packet (02), whose section 09
// lists what must be in before a home is advertised. The routing (who does
// which step) is not modeled in lib/habu-paper yet and is a draft for the
// team to correct.

/** Owner Information Packet §09: documents required before advertising. */
const REQUIRED_BEFORE_ADVERTISING: [string, string][] = [
  ["agreement", "Agency Agreement"],
  ["w9", "Form W-9"],
  ["ach", "Direct Deposit + voided check"],
  ["insurance", "Insurance certificate (HDPM additional insured)"],
  ["license", "Owner’s driver’s license copy"],
  ["inspection", "Owner Inspection items confirmed"],
];

const BLUE: StoryDef = {
  key: "blue",
  label: "Blue folder · Owner onboarding",
  routing: {
    title: "Owner Onboarding (draft)",
    draft: true,
    assignments: [
      { id: "packet", label: "Prepare & send the owner packet", section: "owner", owner: "property-manager", needs: [] },
      { id: "signed", label: "Collect the signed packet & §09 documents", section: "owner", owner: "front-desk", needs: ["packet"] },
      { id: "appfolio", label: "Set up owner & property in AppFolio", section: "setup", owner: "front-desk", needs: ["signed"] },
      { id: "banking", label: "Set up direct deposit & W-9", section: "setup", owner: "accounting", needs: ["signed"] },
      { id: "walkthrough", label: "Owner inspection, keys & photos", section: "property", owner: "property-manager", needs: ["appfolio"] },
      { id: "maint", label: "Complete owner-inspection items & confirm", section: "property", owner: "maintenance", needs: ["walkthrough"] },
      { id: "welcome", label: "Confirm §09 documents · release to advertise", section: "close", owner: "property-manager", needs: ["banking", "maint"] },
    ],
  },
  folder: { id: "OW-14", color: "blue", kindLabel: "Owner onboarding", address: "2715 NE Rainier Dr", city: "Bend", owner: "D. & L. Morgan" },
  initial: {
    holder: "Kennedy",
    tray: "in",
    stepLabel: "Prepare & send the owner packet",
    daysOnDesk: 0,
    done: [],
    docs: [
      { id: "ownerinfo", title: "Owner Information Packet (02)", record: "Owner", stage: "none", note: "Master sheet that rides in the folder: owners, property, utilities, preferences, disclosures" },
      { id: "agreement", title: "Agency Agreement", record: "Owner", stage: "none", note: "Required before advertising" },
      { id: "w9", title: "Form W-9", record: "Owner", stage: "none", note: "Required before advertising · owner supplies" },
      { id: "ach", title: "Authorization for Direct Deposit + voided check", record: "Owner", stage: "none", note: "Required before advertising" },
      { id: "insurance", title: "Insurance Certificate (HDPM additional insured)", record: "Owner", stage: "none", note: "Required before advertising · owner’s insurer supplies" },
      { id: "license", title: "Owner’s driver’s license (copy)", record: "Owner", stage: "none", note: "Required before advertising" },
      { id: "inspection", title: "Owner Inspection", record: "Property", stage: "none", note: "Completed items must be confirmed before advertising" },
      { id: "keys", title: "Key & Remote Receipt", record: "Property", stage: "none" },
    ],
    workOrders: [],
    history: [{ who: "Kennedy", text: "D. & L. Morgan agreed to sign on 2715 NE Rainier Dr. Blue folder OW-14 started." }],
    passed: [],
  },
  steps: [
    {
      action: "print-packet",
      who: "Kennedy",
      title: "A new owner signs on",
      realWorld: "Kennedy prints a blank Owner Information Packet and Agency Agreement, writes the owner’s names and property address on each, and hands them over.",
      inApp: "The blue folder is on his desk. One click prefills the Owner Information Packet (owners, emails, mailing address, rental property, rent) and the Agency Agreement, so what the owner already told us is typed once.",
      button: "Prefill & print the owner packet",
      modal: { kind: "print", docId: "ownerinfo" },
      apply: (s) => ({
        ...s,
        docs: setDocs(s, ["ownerinfo", "agreement", "ach"], "printed"),
        history: note(s, "Kennedy", "Prefilled and printed the Owner Information Packet, Agency Agreement and direct deposit form (QR stamped)."),
      }),
    },
    {
      action: "pass-ashley",
      who: "Kennedy",
      title: "The packet goes to the owner",
      realWorld: "The packet goes out; the folder goes in a pile until something comes back.",
      inApp: "Kennedy signs off his step and passes the folder to Ashley, who owns collecting the signed packet and the section 09 documents.",
      button: "Packet sent: pass to Ashley",
      apply: (s) => ({ ...pass(s, "Kennedy", "Ashley", "collect the signed packet & §09 documents", "Collect the signed packet & §09 documents"), done: [...s.done, "packet"] }),
    },
    {
      action: "wait-owner",
      who: "Ashley",
      title: "Waiting on the owner",
      realWorld: "Nobody is sure which of the required documents came back until someone asks to list the home.",
      inApp: "The folder moves to Ashley’s Waiting on tray with a follow-up date. The back of the folder shows the section 09 checklist, so what’s missing is named.",
      button: "Waiting on the signed packet",
      apply: (s) => ({ ...s, tray: "waiting", waitingOn: "Signed packet, W-9, voided check, insurance cert, license · follow up Mon", history: note(s, "Ashley", "Waiting on the signed packet and section 09 documents. Follow up Monday.") }),
    },
    {
      action: "scan-packet",
      who: "Ashley",
      title: "The signed packet comes back",
      realWorld: "The pages get scanned and someone guesses which owner folder in AppFolio they belong in.",
      inApp: "Ashley scans the signed Owner Information Packet and Agency Agreement with the W-9, voided check, insurance certificate and license copy. The QR codes match OW-14; the section 09 checklist ticks off five of six.",
      button: "Scan back the signed packet",
      modal: { kind: "scan", docId: "ownerinfo" },
      apply: (s) => ({
        ...s,
        tray: "in",
        waitingOn: undefined,
        docs: setDocs(s, ["ownerinfo", "agreement", "ach", "w9", "insurance", "license"], "scanned"),
        done: [...s.done, "signed"],
        history: note(s, "Ashley", "Scanned the signed Owner Information Packet, Agency Agreement, W-9, direct deposit + voided check, insurance certificate and license copy (QR matched OW-14)."),
      }),
    },
    {
      action: "appfolio",
      who: "Ashley",
      title: "Set up the owner and property in AppFolio",
      realWorld: "Ashley retypes four pages of handwriting into AppFolio.",
      inApp: "The packet’s answers (owners, HOA, utilities, features, pets, lease term) sit beside the AppFolio setup screens. The utility providers carry into future rental agreements, as the form requires.",
      button: "Owner & property set up",
      apply: (s) => ({ ...s, done: [...s.done, "appfolio"], stepLabel: "Set up owner & property in AppFolio", history: note(s, "Ashley", "Owner and property created in AppFolio. HOA, utility providers, pet and lease-term preferences entered from the packet.") }),
    },
    {
      action: "pass-penny",
      who: "Ashley",
      title: "Accounting sets up distributions",
      realWorld: "Ashley emails the direct deposit form to Penny and hopes the voided check is attached.",
      inApp: "“Pass to Penny” sends the folder with the signed direct deposit form, voided check and W-9 already inside.",
      button: "Pass to Penny",
      apply: (s) => pass(s, "Ashley", "Penny", "set up direct deposit & W-9", "Set up direct deposit & W-9"),
    },
    {
      action: "banking-pass-kennedy",
      who: "Penny",
      title: "Distributions ready: on to the owner inspection",
      realWorld: "Penny initials the form and sets the folder on Kennedy’s desk.",
      inApp: "Penny enters direct deposit from the voided check, records the W-9 for 1099s, signs off, and passes the folder to Kennedy.",
      button: "Direct deposit set: pass to Kennedy",
      apply: (s) => ({ ...pass(s, "Penny", "Kennedy", "owner inspection, keys & photos", "Owner inspection, keys & photos"), done: [...s.done, "banking"] }),
    },
    {
      action: "print-walk",
      who: "Kennedy",
      title: "Owner inspection",
      realWorld: "Kennedy takes a clipboard and a blank inspection form to the house.",
      inApp: "The Owner Inspection and key receipt print prefilled from the packet: bedrooms, baths, square feet, heat source, fireplace, Ring camera.",
      button: "Prefill & print inspection forms",
      modal: { kind: "print", docId: "inspection" },
      apply: (s) => ({ ...s, docs: setDocs(s, ["inspection", "keys"], "printed"), history: note(s, "Kennedy", "Printed the Owner Inspection and key receipt (QR stamped).") }),
    },
    {
      action: "scan-walk",
      who: "Kennedy",
      title: "Back from the property",
      realWorld: "The marked-up form sits in the truck; the items the owner must complete are easy to forget.",
      inApp: "Kennedy scans the inspection and key receipt. The QR codes match OW-14, and each item to complete goes on the back of the folder. Advertising stays blocked until they’re confirmed.",
      button: "Scan back inspection forms",
      modal: { kind: "scan", docId: "inspection" },
      apply: (s) => ({
        ...s,
        docs: setDocs(s, ["inspection", "keys"], "scanned"),
        done: [...s.done, "walkthrough"],
        workOrders: [
          { text: "Service wood-burning fireplace (last 2024; required yearly)", done: false },
          { text: "Reset Ring camera before rent ready", done: false },
          { text: "Re-hang gutter, north side", done: false },
        ],
        history: note(s, "Kennedy", "Owner inspection done: 3 keys, 1 garage remote received. 3 items to complete before advertising (QR matched OW-14)."),
      }),
    },
    {
      action: "pass-cheryl",
      who: "Kennedy",
      title: "Maintenance completes the items",
      realWorld: "Cheryl hears about the new property the first time something breaks.",
      inApp: "“Pass to Cheryl” sends the folder with the inspection and the three items on the back.",
      button: "Pass to Cheryl",
      apply: (s) => pass(s, "Kennedy", "Cheryl", "complete owner-inspection items & confirm", "Complete owner-inspection items & confirm"),
    },
    {
      action: "maint-pass-kennedy",
      who: "Cheryl",
      title: "Items complete and confirmed",
      realWorld: "Someone tells Kennedy in the hallway that the chimney guy came.",
      inApp: "Cheryl checks off each item as vendors finish, which is the “confirmation of completed items” section 09 asks for, and passes the folder back to Kennedy.",
      button: "Items confirmed: pass to Kennedy",
      apply: (s) => ({
        ...pass(s, "Cheryl", "Kennedy", "confirm §09 documents & release to advertise", "Confirm §09 documents · release to advertise"),
        done: [...s.done, "maint"],
        workOrders: s.workOrders.map((w) => ({ ...w, done: true })),
      }),
    },
    {
      action: "file",
      who: "Kennedy",
      title: "All six required items in: file and release to advertise",
      realWorld: "The home gets listed and someone later notices the insurance certificate never came.",
      inApp: "The section 09 checklist shows six of six. Kennedy files all eight documents to the owner and property records, the folder closes, and the home is cleared to advertise.",
      button: "File all to AppFolio & release",
      modal: { kind: "file" },
      apply: (s) => ({ ...fileAll(s, "Kennedy", "OW-14", 8, "owner and property"), done: [...s.done, "welcome"] }),
    },
  ],
  paper: {
    ownerinfo: {
      title: "Owner Information Packet (02)",
      code: "OWN02",
      typed: [["Owner #1", "Dana Morgan"], ["Owner #2", "Lee Morgan"], ["Owner email", "morgan@example.com"], ["Mailing address", "PO Box 118, Sisters OR"], ["Rental property", "2715 NE Rainier Dr, Bend 97701"], ["Rental rate", "$2,150"]],
      blanks: ["DOB / driver’s license", "HOA · CC&Rs", "Utility providers", "Pets · lease term", "Disclosures (initials)", "Owner signatures"],
      hand: {
        "DOB / driver’s license": "on file (copies attached)",
        "HOA · CC&Rs": "Rainier Ridge HOA · CC&Rs yes",
        "Utility providers": "Avion water, city sewer, Pacific Power, gas",
        "Pets · lease term": "pets yes, no breed limits · 12 mo",
        "Disclosures (initials)": "DM LM  no lead / no drug info",
        "Owner signatures": "Dana Morgan · Lee Morgan",
      },
      with: "The Agency Agreement and direct deposit form print with it. Section 09 asks the owner for a W-9, voided check, insurance certificate naming HDPM as additional insured, and a copy of their driver’s license.",
      scanNote: "The Agency Agreement, W-9, direct deposit form with voided check, insurance certificate and license copy were in the same batch and matched too. Section 09: 5 of 6 in; the Owner Inspection is still to come.",
    },
    inspection: {
      title: "Owner Inspection",
      code: "OWNINSP",
      typed: [["Property", "2715 NE Rainier Dr, Bend"], ["Owner", "D. & L. Morgan"], ["From the packet", "3 bd / 2 ba · 1,640 sq ft · gas heat"], ["Flagged by packet", "Wood fireplace · Ring camera"], ["Inspection", "Oct 24, 2026"]],
      blanks: ["Fireplace service", "Ring camera", "Exterior", "Keys & remotes", "Inspector signature"],
      hand: { "Fireplace service": "last 2024: needs service", "Ring camera": "reset before rent ready", Exterior: "gutter loose, north side", "Keys & remotes": "3 keys + 1 garage remote", "Inspector signature": "K. —" },
      with: "The Key & Remote Receipt prints with it.",
      scanNote: "3 items to complete on the page. Confirm and they go on the back of the folder; advertising waits until they’re done.",
    },
  },
  details: (s) => [
    ["Owners", "Dana & Lee Morgan (sample)"],
    ["Property", "3 bd / 2 ba · $2,150"],
    ...REQUIRED_BEFORE_ADVERTISING.map(([id, label]): [string, string] => {
      const doc = s.docs.find((d) => d.id === id);
      const ok = id === "inspection" ? s.done.includes("maint") : doc && doc.stage !== "none" && doc.stage !== "prefilled" && doc.stage !== "printed";
      return [`§09 ${label}`, ok ? "✓ in" : "missing"];
    }),
  ],
  closing: "Folder OW-14 is closed: all six section 09 items are in, every document is filed, and the home is cleared to advertise.",
};

export const STORIES: StoryDef[] = [GOLD, GREEN, BLUE];
