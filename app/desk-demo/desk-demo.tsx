"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, FileText, Inbox, Printer, RotateCcw, ScanLine, Send, Upload, X } from "lucide-react";
import { TEMPLATES } from "@/lib/habu-paper/model";

/**
 * The Desk — Stage 0 demo (docs/habu-desk-plan.md). Follows one gold
 * vacancy folder across four desks. All data is sample data held in page
 * state; nothing is saved, printed, uploaded or sent.
 */

type Person = "Ashley" | "Kennedy" | "Cheryl" | "Penny";
const PEOPLE: { name: Person; role: string }[] = [
  { name: "Ashley", role: "Front Desk" },
  { name: "Kennedy", role: "Property Manager" },
  { name: "Cheryl", role: "Maintenance" },
  { name: "Penny", role: "Accounting" },
];
// The vacancy template's roles, mapped to the people who hold them.
const ROLE_PERSON: Record<string, Person> = {
  "front-desk": "Ashley",
  "property-manager": "Kennedy",
  maintenance: "Cheryl",
  accounting: "Penny",
};

type Color = "gold" | "green" | "blue";
const FOLDER: Record<Color, { label: string; fill: string; edge: string; ink: string }> = {
  gold: { label: "Gold · Vacancy", fill: "#fbf1d2", edge: "#d4a017", ink: "#7a5a00" },
  green: { label: "Green · New tenant setup", fill: "#e3f1e4", edge: "#3f8f4f", ink: "#245c30" },
  blue: { label: "Blue · Owner onboarding (example)", fill: "#e2ebf7", edge: "#3b6fb6", ink: "#1f4478" },
};

type DocStage = "none" | "prefilled" | "printed" | "scanned" | "filed";
const STAGES: { key: DocStage; label: string }[] = [
  { key: "prefilled", label: "Prefilled" },
  { key: "printed", label: "On paper" },
  { key: "scanned", label: "Scanned back" },
  { key: "filed", label: "Filed in AppFolio" },
];
interface Doc {
  id: string;
  title: string;
  record: string; // AppFolio record it files to
  stage: DocStage;
  note?: string;
}

interface Folder {
  id: string;
  color: Color;
  title: string;
  address: string;
  holder: Person | "Filed";
  tray: "in" | "waiting";
  step: string;
  days: number;
  due?: string;
  overdue?: boolean;
  waitingOn?: string;
  main?: boolean;
}

// Other folders already on desks, so each desk looks like a real Tuesday.
const BACKGROUND: Folder[] = [
  { id: "NT-207", color: "green", title: "New tenant setup", address: "63310 Birch Ct", holder: "Ashley", tray: "in", step: "Application review", days: 1, due: "today" },
  { id: "VT-116", color: "gold", title: "Vacancy", address: "2144 NE Wells Acres Rd", holder: "Ashley", tray: "in", step: "Receipt returned keys", days: 2 },
  { id: "OW-12", color: "blue", title: "Owner onboarding", address: "1188 SW Cascade Ave", holder: "Ashley", tray: "waiting", step: "Owner packet", days: 4, waitingOn: "W-9 from owner · follow up Thu" },
  { id: "VT-109", color: "gold", title: "Vacancy", address: "907 NW Portland Ave", holder: "Kennedy", tray: "in", step: "Inspect the unit", days: 5, overdue: true, due: "2 days ago" },
  { id: "NT-203", color: "green", title: "New tenant setup", address: "20511 Sierra Dr", holder: "Kennedy", tray: "in", step: "Rental agreement prep", days: 1, due: "today" },
  { id: "VT-111", color: "gold", title: "Vacancy", address: "61234 Parrell Rd", holder: "Kennedy", tray: "waiting", step: "Confirm owner & listing", days: 3, waitingOn: "Owner reply · follow up tomorrow" },
  { id: "VT-105", color: "gold", title: "Vacancy", address: "1611 SW Juniper Ave", holder: "Cheryl", tray: "in", step: "Complete turn work orders", days: 6, overdue: true, due: "yesterday" },
  { id: "VT-110", color: "gold", title: "Vacancy", address: "3355 NE Purcell Blvd", holder: "Cheryl", tray: "in", step: "Complete turn work orders", days: 2, due: "Fri" },
  { id: "NT-201", color: "green", title: "New tenant setup", address: "52 NW Gasoline Alley", holder: "Penny", tray: "in", step: "Confirm move-in funds", days: 1, due: "today" },
  { id: "VT-102", color: "gold", title: "Vacancy", address: "2980 SW Obsidian Ave", holder: "Penny", tray: "in", step: "Complete tenant accounting", days: 3, due: "Thu" },
];

interface State {
  holder: Person | "Filed";
  tray: "in" | "waiting";
  waitingOn?: string;
  stepLabel: string;
  daysOnDesk: number;
  done: string[]; // vacancy assignment ids signed off
  docs: Doc[];
  workOrders: { text: string; done: boolean }[];
  history: { who: string; text: string }[];
  passed: { from: Person; to: Person | "Filed"; what: string }[];
}

const INITIAL: State = {
  holder: "Ashley",
  tray: "in",
  stepLabel: "Prepare and submit notice",
  daysOnDesk: 0,
  done: [],
  docs: [
    { id: "notice", title: "Tenant’s notice to vacate", record: "Tenant record", stage: "scanned", note: "Arrived by email: already a scan" },
    { id: "confirm", title: "Confirmation of notice to vacate", record: "Tenant record", stage: "none" },
    { id: "tracking", title: "Gold vacancy tracking sheet", record: "Property record", stage: "none", note: "Master sheet that rides in the folder" },
    { id: "inspection", title: "Move-out inspection", record: "Tenant record", stage: "none" },
    { id: "accounting", title: "Final accounting & deposit statement", record: "Tenant record", stage: "none" },
  ],
  workOrders: [],
  history: [{ who: "Ashley", text: "Notice to vacate received for 1420 NW Elm Ave #B. Gold folder VT-118 started." }],
  passed: [],
};

type ActionId =
  | "print-front"
  | "pass-kennedy"
  | "email-owner"
  | "owner-replied"
  | "print-inspection"
  | "scan-inspection"
  | "pass-cheryl"
  | "complete-wos"
  | "pass-verify"
  | "verify-pass-penny"
  | "closeout"
  | "file";

interface StoryStep {
  action: ActionId;
  who: Person;
  title: string;
  realWorld: string;
  inApp: string;
  button: string;
  apply: (s: State) => State;
}

const setDoc = (s: State, id: string, stage: DocStage): Doc[] => s.docs.map((d) => (d.id === id ? { ...d, stage } : d));
const pass = (s: State, from: Person, to: Person, what: string, stepLabel: string): State => ({
  ...s,
  holder: to,
  tray: "in",
  waitingOn: undefined,
  stepLabel,
  daysOnDesk: 0,
  passed: [{ from, to, what }, ...s.passed],
  history: [...s.history, { who: from, text: `Passed the folder to ${to}: ${what}.` }],
});

const STORY: StoryStep[] = [
  {
    action: "print-front",
    who: "Ashley",
    title: "A notice to vacate arrives",
    realWorld: "Ashley pulls a gold folder, fills in the tracking sheet by hand and types a confirmation letter.",
    inApp: "The gold folder is already on her desk. One click prefills the tracking sheet and the confirmation letter with the tenant, unit, owner and dates, then prints them with a QR code in the corner.",
    button: "Prefill & print both forms",
    apply: (s) => ({
      ...s,
      docs: setDoc({ ...s, docs: setDoc(s, "tracking", "printed") }, "confirm", "printed"),
      history: [...s.history, { who: "Ashley", text: "Prefilled and printed the tracking sheet and confirmation letter (QR stamped)." }],
    }),
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
    apply: (s) => ({
      ...s,
      tray: "waiting",
      waitingOn: "Owner approval · follow up Thu",
      history: [...s.history, { who: "Kennedy", text: "Emailed the owner for approval to list. Follow up Thursday." }],
    }),
  },
  {
    action: "owner-replied",
    who: "Kennedy",
    title: "The owner replies",
    realWorld: "Kennedy digs the folder back out of the stack.",
    inApp: "One click puts it back in the In tray. Owner and listing are signed off, and the keys come back.",
    button: "Owner approved: back to In",
    apply: (s) => ({
      ...s,
      tray: "in",
      waitingOn: undefined,
      stepLabel: "Inspect the unit",
      done: [...s.done, "owner", "advertising", "keys"],
      history: [...s.history, { who: "Kennedy", text: "Owner approved listing at $1,895. Keys returned and receipted." }],
    }),
  },
  {
    action: "print-inspection",
    who: "Kennedy",
    title: "Print the move-out inspection",
    realWorld: "Kennedy prints a blank inspection form and writes the address and names by hand.",
    inApp: "The inspection form prints already filled in with the unit, tenant, move-out date and the move-in condition notes. Kennedy only writes what she finds.",
    button: "Prefill & print inspection",
    apply: (s) => ({
      ...s,
      docs: setDoc(s, "inspection", "printed"),
      history: [...s.history, { who: "Kennedy", text: "Printed the prefilled move-out inspection (QR stamped)." }],
    }),
  },
  {
    action: "scan-inspection",
    who: "Kennedy",
    title: "Scan the hand-written inspection back",
    realWorld: "The written form goes back in the folder and might get scanned weeks later, into the wrong record.",
    inApp: "Kennedy scans it. The QR code tells the app which folder and form it is, and the three repairs she wrote down become work orders on the back of the folder.",
    button: "Scan back inspection",
    apply: (s) => ({
      ...s,
      docs: setDoc(s, "inspection", "scanned"),
      done: [...s.done, "inspection"],
      workOrders: [
        { text: "Patch and paint hallway wall", done: false },
        { text: "Replace bathroom fan cover", done: false },
        { text: "Deep clean carpet, back bedroom", done: false },
      ],
      history: [...s.history, { who: "Kennedy", text: "Scanned the inspection back (QR matched VT-118 · Move-out inspection v1). 3 turn work orders added." }],
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
    apply: (s) => ({
      ...s,
      workOrders: s.workOrders.map((w) => ({ ...w, done: true })),
      done: [...s.done, "turn-work"],
      history: [...s.history, { who: "Cheryl", text: "Completed all 3 turn work orders." }],
    }),
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
    inApp: "The deposit statement is generated from the ledger. Penny scans the tracking sheet and confirmation letter back, and the QR codes match them to this folder.",
    button: "Finish accounting & scan back",
    apply: (s) => ({
      ...s,
      done: [...s.done, "closeout"],
      docs: s.docs.map((d) =>
        d.id === "accounting" ? { ...d, stage: "prefilled" } : d.id === "tracking" || d.id === "confirm" ? { ...d, stage: "scanned" } : d
      ),
      history: [...s.history, { who: "Penny", text: "Deposit statement generated. Tracking sheet and confirmation scanned back (QR matched)." }],
    }),
  },
  {
    action: "file",
    who: "Penny",
    title: "File everything in AppFolio and close the folder",
    realWorld: "Someone eventually uploads the scans, if they remember and pick the right record.",
    inApp: "Every document files to the right AppFolio record with a standard file name. The folder closes only when all of them show as filed.",
    button: "File all to AppFolio & close",
    apply: (s) => ({
      ...s,
      holder: "Filed",
      docs: s.docs.map((d) => ({ ...d, stage: "filed" })),
      passed: [{ from: "Penny", to: "Filed", what: "all documents filed in AppFolio" }, ...s.passed],
      history: [...s.history, { who: "Penny", text: "Filed 5 documents to the tenant and property records in AppFolio. Folder VT-118 closed." }],
    }),
  },
];

export default function DeskDemo() {
  const [state, setState] = useState<State>(INITIAL);
  const [stepIdx, setStepIdx] = useState(0);
  const [desk, setDesk] = useState<Person | "Office">("Ashley");
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"route" | "contents" | "back" | "history">("contents");
  const [modal, setModal] = useState<null | { kind: "print" | "scan" | "file"; docId?: string }>(null);

  const current = STORY[stepIdx] as StoryStep | undefined;
  const finished = stepIdx >= STORY.length;

  const act = (action: ActionId) => {
    if (!current || current.action !== action) return;
    setState((s) => current.apply(s));
    setStepIdx((i) => i + 1);
    const next = STORY[stepIdx + 1];
    if (next && next.who !== current.who) {
      setDesk(next.who);
    }
  };

  // Show the right preview for print/scan/file steps, otherwise act directly.
  const runStep = () => {
    if (!current) return;
    if (desk !== current.who) setDesk(current.who);
    setOpen("VT-118");
    if (current.action === "print-front") setModal({ kind: "print", docId: "tracking" });
    else if (current.action === "print-inspection") setModal({ kind: "print", docId: "inspection" });
    else if (current.action === "scan-inspection") setModal({ kind: "scan", docId: "inspection" });
    else if (current.action === "closeout") setModal({ kind: "scan", docId: "tracking" });
    else if (current.action === "file") setModal({ kind: "file" });
    else act(current.action);
  };

  const main: Folder = {
    id: "VT-118",
    color: "gold",
    title: "Vacancy",
    address: "1420 NW Elm Ave #B",
    holder: state.holder,
    tray: state.tray,
    step: state.stepLabel,
    days: state.daysOnDesk,
    due: state.tray === "waiting" ? undefined : "Fri",
    waitingOn: state.waitingOn,
    main: true,
  };
  const folders = useMemo(() => [main, ...BACKGROUND], [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setState(INITIAL);
    setStepIdx(0);
    setDesk("Ashley");
    setOpen(null);
    setModal(null);
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-charcoal-400">Demo · sample data · nothing is saved, printed or sent</p>
          <h1 className="text-xl font-semibold tracking-tight text-charcoal-950">The Desk</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-charcoal-500">
            Every folder circulating the office, on the right person&apos;s desk, in the order to work it, with every form tracked from
            printout to AppFolio.
          </p>
        </div>
        <button onClick={reset} className="flex items-center gap-1.5 rounded-lg border border-sand-200 px-3 py-1.5 text-[12.5px] text-charcoal-600 hover:bg-sand-50">
          <RotateCcw className="h-3.5 w-3.5" /> Start over
        </button>
      </div>

      {/* Guided story */}
      <div className="mb-5 rounded-xl border border-sand-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-1">
          {STORY.map((s, i) => (
            <div
              key={s.action}
              title={`${i + 1}. ${s.title} (${s.who})`}
              className={`h-1.5 flex-1 rounded-full ${i < stepIdx ? "bg-charcoal-900" : i === stepIdx ? "bg-[#d4a017]" : "bg-sand-200"}`}
            />
          ))}
        </div>
        {finished ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-charcoal-900">Folder VT-118 is closed: every step signed off, every document filed.</p>
              <p className="text-[12.5px] text-charcoal-500">
                Open the Office view to see it filed, or click any desk to see what&apos;s still on it.
              </p>
            </div>
            <button onClick={() => setDesk("Office")} className="rounded-lg bg-charcoal-900 px-3 py-2 text-[13px] font-medium text-white">
              Office view
            </button>
          </div>
        ) : (
          current && (
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-center">
              <div>
                <p className="text-[11px] font-medium text-charcoal-400">
                  Step {stepIdx + 1} of {STORY.length} · {current.who}&apos;s desk
                </p>
                <p className="text-[15px] font-semibold text-charcoal-900">{current.title}</p>
                <p className="mt-1 text-[12px] text-charcoal-500">
                  <span className="font-semibold text-charcoal-600">Today on paper: </span>
                  {current.realWorld}
                </p>
              </div>
              <p className="rounded-lg bg-sand-50 p-3 text-[12.5px] leading-snug text-charcoal-700">
                <span className="font-semibold text-charcoal-900">With the Desk: </span>
                {current.inApp}
              </p>
              <button
                onClick={runStep}
                className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-charcoal-900 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-charcoal-800"
              >
                {current.button} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )
        )}
      </div>

      {/* Desk switcher */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {PEOPLE.map((p) => {
          const count = folders.filter((f) => f.holder === p.name).length;
          const hasMain = state.holder === p.name;
          return (
            <button
              key={p.name}
              onClick={() => setDesk(p.name)}
              className={`relative rounded-lg border px-3 py-1.5 text-left text-[12.5px] ${desk === p.name ? "border-charcoal-900 bg-charcoal-900 text-white" : "border-sand-200 bg-white text-charcoal-700 hover:bg-sand-50"}`}
            >
              <span className="font-semibold">{p.name}</span>
              <span className={desk === p.name ? "text-white/60" : "text-charcoal-400"}> · {p.role}</span>
              <span className={`ml-2 rounded-full px-1.5 text-[10.5px] font-semibold ${desk === p.name ? "bg-white/20" : "bg-sand-100"}`}>{count}</span>
              {hasMain && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#d4a017] ring-2 ring-white" title="VT-118 is here" />}
            </button>
          );
        })}
        <button
          onClick={() => setDesk("Office")}
          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${desk === "Office" ? "border-charcoal-900 bg-charcoal-900 text-white" : "border-sand-200 bg-white text-charcoal-700 hover:bg-sand-50"}`}
        >
          Office view: where is every folder?
        </button>
      </div>

      <div className={`grid gap-5 ${open ? "xl:grid-cols-[1fr_560px]" : ""}`}>
        {desk === "Office" ? (
          <OfficeView folders={folders} onOpen={(id) => setOpen(id)} filed={state.holder === "Filed"} />
        ) : (
          <DeskView person={desk} folders={folders} passed={state.passed.filter((p) => p.from === desk)} onOpen={(id) => setOpen(id)} highlight={current?.who === desk} />
        )}

        {open && (
          <FolderPanel
            folder={folders.find((f) => f.id === open)!}
            state={state}
            tab={tab}
            setTab={setTab}
            onClose={() => setOpen(null)}
            current={current}
            viewer={desk}
            onAct={(a) => {
              if (a === "print-front") setModal({ kind: "print", docId: "tracking" });
              else if (a === "print-inspection") setModal({ kind: "print", docId: "inspection" });
              else if (a === "scan-inspection") setModal({ kind: "scan", docId: "inspection" });
              else if (a === "closeout") setModal({ kind: "scan", docId: "tracking" });
              else if (a === "file") setModal({ kind: "file" });
              else act(a);
            }}
          />
        )}
      </div>

      {modal && (
        <Modal onClose={() => setModal(null)}>
          {modal.kind === "print" && (
            <PrintPreview
              docId={modal.docId!}
              onConfirm={() => {
                act(modal.docId === "inspection" ? "print-inspection" : "print-front");
                setModal(null);
              }}
            />
          )}
          {modal.kind === "scan" && (
            <ScanBack
              docId={modal.docId!}
              onConfirm={() => {
                act(modal.docId === "inspection" ? "scan-inspection" : "closeout");
                setModal(null);
              }}
            />
          )}
          {modal.kind === "file" && (
            <FileToAppFolio
              docs={state.docs}
              onConfirm={() => {
                act("file");
                setModal(null);
                setDesk("Office");
              }}
            />
          )}
        </Modal>
      )}

      <p className="mt-6 text-[11.5px] leading-relaxed text-charcoal-400">
        Demo only: sample people, properties and folders. The routing follows the gold vacancy sheet already modeled in HDPM-OS (notice →
        owner & keys → inspection → turn work → verify, plus accounting closeout). Folder colors other than gold and green are placeholders.
        Plan: docs/habu-desk-plan.md.
      </p>
    </div>
  );
}

// ── Desk ──────────────────────────────────────────────────

function FolderTab({ f, onOpen, pulse }: { f: Folder; onOpen: () => void; pulse?: boolean }) {
  const c = FOLDER[f.color];
  return (
    <button
      onClick={onOpen}
      className={`group relative w-full text-left transition-transform hover:-translate-y-0.5 ${pulse ? "animate-pulse" : ""}`}
      title={`${c.label} · ${f.id}`}
    >
      {/* folder tab */}
      <span className="ml-3 inline-block rounded-t-md px-2 py-0.5 text-[10px] font-bold tracking-wide" style={{ background: c.edge, color: "#fff" }}>
        {f.id}
      </span>
      <span
        className={`block rounded-lg rounded-tl-none border px-3 py-2 shadow-sm ${f.main ? "ring-2 ring-offset-1" : ""}`}
        style={{ background: c.fill, borderColor: c.edge, ...(f.main ? { ["--tw-ring-color" as string]: c.edge } : {}) }}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-charcoal-900">{f.address}</span>
          <span className={`whitespace-nowrap text-[11px] font-semibold ${f.overdue ? "text-red-600" : "text-charcoal-500"}`}>
            {f.overdue ? `overdue · ${f.due}` : f.due ? `due ${f.due}` : ""}
          </span>
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: c.ink }}>
          <span className="truncate">{f.waitingOn ?? f.step}</span>
          <span className="whitespace-nowrap text-charcoal-400">{f.days === 0 ? "just arrived" : `${f.days}d on desk`}</span>
        </span>
      </span>
    </button>
  );
}

function Tray({ title, hint, icon, children, empty }: { title: string; hint: string; icon: React.ReactNode; children: React.ReactNode; empty: string }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="flex flex-col rounded-xl border border-sand-200 bg-sand-50/60">
      <div className="flex items-center gap-2 border-b border-sand-200 px-3 py-2">
        {icon}
        <p className="text-[13px] font-semibold text-charcoal-800">{title}</p>
        <p className="ml-auto text-[11px] text-charcoal-400">{hint}</p>
      </div>
      <div className="flex min-h-[180px] flex-col gap-2 p-3">
        {hasItems ? children : <p className="py-6 text-center text-[12px] text-charcoal-400">{empty}</p>}
      </div>
    </div>
  );
}

function DeskView({
  person,
  folders,
  passed,
  onOpen,
  highlight,
}: {
  person: Person;
  folders: Folder[];
  passed: { from: Person; to: Person | "Filed"; what: string }[];
  onOpen: (id: string) => void;
  highlight: boolean;
}) {
  const mine = folders.filter((f) => f.holder === person);
  // Work order: overdue first, then the demo folder, then longest on desk.
  const order = (a: Folder, b: Folder) => Number(!!b.overdue) - Number(!!a.overdue) || b.days - a.days;
  const inTray = mine.filter((f) => f.tray === "in").sort(order);
  const waiting = mine.filter((f) => f.tray === "waiting");
  const role = PEOPLE.find((p) => p.name === person)!.role;
  const overdue = inTray.filter((f) => f.overdue).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-[17px] font-semibold text-charcoal-950">{person}&apos;s desk</p>
        <p className="text-[12.5px] text-charcoal-500">
          {role} · {inTray.length} to work · {waiting.length} waiting{overdue ? ` · ` : ""}
          {overdue > 0 && <span className="font-semibold text-red-600">{overdue} overdue</span>}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Tray title="In" hint="top = work next" icon={<Inbox className="h-4 w-4 text-charcoal-500" />} empty="Nothing waiting on you.">
          {inTray.map((f) => (
            <FolderTab key={f.id} f={f} onOpen={() => onOpen(f.id)} pulse={f.main && highlight} />
          ))}
        </Tray>
        <Tray title="Waiting on" hint="blocked · has a follow-up" icon={<ChevronRight className="h-4 w-4 text-charcoal-500" />} empty="Nothing on hold.">
          {waiting.map((f) => (
            <FolderTab key={f.id} f={f} onOpen={() => onOpen(f.id)} pulse={f.main && highlight} />
          ))}
        </Tray>
        <Tray title="Passed on" hint="where your folders went" icon={<Send className="h-4 w-4 text-charcoal-500" />} empty="Nothing passed on yet today.">
          {passed.map((p, i) => (
            <button key={i} onClick={() => onOpen("VT-118")} className="flex items-center gap-2 rounded-lg border border-sand-200 bg-white px-3 py-2 text-left text-[12px]">
              <span className="h-6 w-1.5 rounded" style={{ background: FOLDER.gold.edge }} />
              <span className="min-w-0">
                <span className="font-semibold text-charcoal-900">VT-118 → {p.to === "Filed" ? "Filed in AppFolio" : p.to}</span>
                <span className="block truncate text-charcoal-500">{p.what}</span>
              </span>
            </button>
          ))}
        </Tray>
      </div>
    </div>
  );
}

function OfficeView({ folders, onOpen, filed }: { folders: Folder[]; onOpen: (id: string) => void; filed: boolean }) {
  return (
    <div>
      <p className="mb-3 text-[17px] font-semibold text-charcoal-950">Where is every folder?</p>
      <div className="grid gap-3 md:grid-cols-5">
        {PEOPLE.map((p) => {
          const mine = folders.filter((f) => f.holder === p.name);
          return (
            <div key={p.name} className="rounded-xl border border-sand-200 bg-sand-50/60 p-3">
              <p className="text-[13px] font-semibold text-charcoal-900">
                {p.name} <span className="font-normal text-charcoal-400">· {mine.length}</span>
              </p>
              <p className="mb-2 text-[11px] text-charcoal-400">{p.role}</p>
              <div className="flex flex-col gap-1.5">
                {mine.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => onOpen(f.id)}
                    className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-left text-[11.5px]"
                    style={{ borderColor: FOLDER[f.color].edge }}
                  >
                    <span className="h-4 w-1.5 rounded" style={{ background: FOLDER[f.color].edge }} />
                    <span className="min-w-0 flex-1 truncate">
                      <b>{f.id}</b> {f.tray === "waiting" ? "· waiting" : ""}
                    </span>
                    {f.overdue && <span className="font-semibold text-red-600">late</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="rounded-xl border border-dashed border-sand-300 p-3">
          <p className="text-[13px] font-semibold text-charcoal-900">Filed &amp; closed</p>
          <p className="mb-2 text-[11px] text-charcoal-400">everything in AppFolio</p>
          {filed ? (
            <button onClick={() => onOpen("VT-118")} className="flex w-full items-center gap-2 rounded-md border border-green-300 bg-green-50 px-2 py-1.5 text-left text-[11.5px] text-green-800">
              <Check className="h-3.5 w-3.5" /> <b>VT-118</b> · 1420 NW Elm Ave #B
            </button>
          ) : (
            <p className="text-[11.5px] text-charcoal-400">Nothing closed yet today.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-[11.5px] text-charcoal-500">
        {(Object.keys(FOLDER) as Color[]).map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: FOLDER[c].edge }} /> {FOLDER[c].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Folder panel ──────────────────────────────────────────

function FolderPanel({
  folder,
  state,
  tab,
  setTab,
  onClose,
  current,
  viewer,
  onAct,
}: {
  folder: Folder;
  state: State;
  tab: "route" | "contents" | "back" | "history";
  setTab: (t: "route" | "contents" | "back" | "history") => void;
  onClose: () => void;
  current: StoryStep | undefined;
  viewer: Person | "Office";
  onAct: (a: ActionId) => void;
}) {
  const c = FOLDER[folder.color];
  if (!folder.main) {
    return (
      <div className="h-fit rounded-xl border-2 p-4" style={{ borderColor: c.edge, background: c.fill }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wide" style={{ color: c.ink }}>
              {c.label.toUpperCase()} · {folder.id}
            </p>
            <p className="text-[16px] font-semibold text-charcoal-900">{folder.address}</p>
            <p className="text-[12.5px] text-charcoal-600">
              With {folder.holder} · {folder.waitingOn ?? folder.step}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-charcoal-500 hover:text-charcoal-900">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-[12px] text-charcoal-600">Background folder for the demo. Follow the gold folder VT-118 to see the full story.</p>
      </div>
    );
  }

  const tmpl = TEMPLATES.vacancy;
  const canAct = current && viewer === current.who && state.holder === current.who;
  return (
    <div className="h-fit overflow-hidden rounded-xl border-2 bg-white" style={{ borderColor: c.edge }}>
      <div className="px-4 py-3" style={{ background: c.fill }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-wide" style={{ color: c.ink }}>
              GOLD FOLDER · VACANCY · VT-118
            </p>
            <p className="text-[16px] font-semibold text-charcoal-900">1420 NW Elm Ave #B, Bend</p>
            <p className="text-[12.5px] text-charcoal-600">
              {state.holder === "Filed" ? "Closed · all documents filed" : `On ${state.holder}’s desk · ${state.waitingOn ?? state.stepLabel}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close folder" className="text-charcoal-500 hover:text-charcoal-900">
            <X className="h-4 w-4" />
          </button>
        </div>
        {canAct && current && (
          <button
            onClick={() => onAct(current.action)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-charcoal-800"
          >
            {current.button} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex gap-4 border-b border-sand-200 px-4">
        {(
          [
            ["contents", "Folder contents"],
            ["route", "Routing slip"],
            ["back", "Back of sheet"],
            ["history", "History"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 py-2 text-[12.5px] font-medium ${tab === k ? "border-charcoal-950 text-charcoal-950" : "border-transparent text-charcoal-400 hover:text-charcoal-800"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "contents" && (
          <div className="space-y-2">
            {state.docs.map((d) => (
              <div key={d.id} className="rounded-lg border border-sand-200 p-2.5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-charcoal-400" />
                  <p className="flex-1 text-[13px] font-medium text-charcoal-900">{d.title}</p>
                  <span className="text-[10.5px] text-charcoal-400">→ {d.record}</span>
                </div>
                {d.note && <p className="ml-6 text-[11px] text-charcoal-400">{d.note}</p>}
                <div className="ml-6 mt-1.5 flex items-center gap-1">
                  {STAGES.map((st, i) => {
                    const reached = STAGES.findIndex((x) => x.key === d.stage) >= i;
                    return (
                      <span key={st.key} className="flex items-center gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${reached ? (st.key === "filed" ? "bg-green-600 text-white" : "bg-charcoal-900 text-white") : "bg-sand-100 text-charcoal-400"}`}
                        >
                          {st.label}
                        </span>
                        {i < STAGES.length - 1 && <span className="text-charcoal-200">›</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-charcoal-400">
              Every printed form carries a QR code, so a scan finds its own folder. The folder closes only when every document says
              “Filed in AppFolio”.
            </p>
          </div>
        )}

        {tab === "route" && (
          <div>
            <p className="mb-2 text-[12px] text-charcoal-500">How this folder moves (the gold vacancy sheet&apos;s routing, assigned to people):</p>
            <ol className="space-y-1.5">
              {tmpl.assignments.map((a) => {
                const done = state.done.includes(a.id);
                const ready = !done && a.needs.every((n) => state.done.includes(n));
                const who = ROLE_PERSON[a.owner];
                return (
                  <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-charcoal-900 text-white" : ready ? "bg-[#d4a017] text-white" : "bg-sand-100 text-charcoal-400"}`}
                    >
                      {done ? <Check className="h-3 w-3" /> : ""}
                    </span>
                    <span className={`flex-1 ${done ? "text-charcoal-400 line-through" : "text-charcoal-800"}`}>{a.label}</span>
                    <span className="text-[11.5px] font-medium text-charcoal-600">{who}</span>
                    {a.needs.length > 0 && !done && (
                      <span className="text-[10.5px] text-charcoal-400">after {a.needs.map((n) => tmpl.assignments.find((x) => x.id === n)?.label.split(" ")[0]).join(" + ")}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {tab === "back" && (
          <div>
            <p className="mb-2 text-[12px] font-semibold text-charcoal-700">Turn work orders</p>
            {state.workOrders.length === 0 ? (
              <p className="text-[12px] text-charcoal-400">None yet. They come from the scanned move-out inspection.</p>
            ) : (
              <ul className="space-y-1">
                {state.workOrders.map((w) => (
                  <li key={w.text} className="flex items-center gap-2 text-[12.5px]">
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${w.done ? "border-charcoal-900 bg-charcoal-900 text-white" : "border-sand-300"}`}>
                      {w.done && <Check className="h-3 w-3" />}
                    </span>
                    <span className={w.done ? "text-charcoal-400 line-through" : "text-charcoal-800"}>{w.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-1 mt-4 text-[12px] font-semibold text-charcoal-700">Key details (front of sheet)</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
              {[
                ["Tenant", "J. Rivera (sample)"],
                ["Move-out", "Oct 15"],
                ["Owner", "Pine Ridge Holdings LLC (sample)"],
                ["Listing rent", state.done.includes("owner") ? "$1,895" : "(pending owner)"],
                ["Keys", state.done.includes("keys") ? "2 keys, 1 fob: receipted" : "(not returned)"],
                ["Deposit", "$1,800"],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-charcoal-400">{k}</dt>
                  <dd className="text-charcoal-800">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {tab === "history" && (
          <ol className="space-y-1.5 text-[12px]">
            {[...state.history].reverse().map((h, i) => (
              <li key={i}>
                <b className="text-charcoal-900">{h.who}</b> <span className="text-charcoal-600">{h.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Print / scan / file previews ──────────────────────────

/** Deterministic QR-looking stamp (illustrative, not scannable). */
function QrStamp({ seed, size = 64 }: { seed: string; size?: number }) {
  const n = 21;
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const cells: boolean[] = [];
  for (let i = 0; i < n * n; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    cells.push((h & 1) === 1);
  }
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      if (inBox(ox, oy)) {
        const dx = x - ox, dy = y - oy;
        return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
      }
    }
    return null;
  };
  const s = size / n;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="QR code (illustration)">
      <rect width={size} height={size} fill="#fff" />
      {Array.from({ length: n * n }, (_, i) => {
        const x = i % n, y = Math.floor(i / n);
        const f = finder(x, y);
        const on = f ?? cells[i];
        return on ? <rect key={i} x={x * s} y={y * s} width={s} height={s} fill="#111" /> : null;
      })}
    </svg>
  );
}

const DOC_TITLES: Record<string, string> = {
  tracking: "Gold Vacancy Tracking Sheet",
  inspection: "Move-out Inspection",
};

function PaperPage({ docId, handwritten }: { docId: string; handwritten?: boolean }) {
  const typed = "font-mono text-[11px] text-[#1b3a8a]";
  const hand = { fontFamily: "'Bradley Hand','Segoe Print','Comic Sans MS',cursive", color: "#1f2a44" } as const;
  const rows =
    docId === "inspection"
      ? [
          ["Property", "1420 NW Elm Ave #B, Bend"],
          ["Tenant", "J. Rivera"],
          ["Move-out date", "Oct 15, 2026"],
          ["Move-in notes", "Minor wear, living room carpet (2023)"],
        ]
      : [
          ["Property", "1420 NW Elm Ave #B, Bend"],
          ["Tenant", "J. Rivera"],
          ["Notice received", "Sep 29, 2026"],
          ["Move-out date", "Oct 15, 2026"],
          ["Owner", "Pine Ridge Holdings LLC"],
        ];
  const blanks =
    docId === "inspection"
      ? ["Walls & paint", "Bathroom", "Carpet / flooring", "Appliances", "Inspector signature"]
      : ["Keys returned", "Listing rent", "Inspection date", "Notes"];
  const handValues: Record<string, string> = {
    "Walls & paint": "hallway wall gouge: patch + paint",
    Bathroom: "fan cover cracked",
    "Carpet / flooring": "back bedroom stains: deep clean",
    Appliances: "ok",
    "Inspector signature": "K. —",
    "Keys returned": "2 keys + fob  ✓",
    "Listing rent": "$1,895",
    "Inspection date": "10/16",
    Notes: "owner ok'd paint",
  };
  return (
    <div className="relative mx-auto aspect-[8.5/11] w-full max-w-[380px] border border-sand-300 bg-white p-5 shadow-md">
      <div className="absolute right-3 top-3 text-right">
        <QrStamp seed={`VT-118-${docId}`} size={56} />
        <p className="mt-0.5 font-mono text-[7.5px] text-charcoal-500">VT-118 · {docId === "inspection" ? "INSP" : "TRACK"} · v1</p>
      </div>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-charcoal-400">High Desert Property Management</p>
      <p className="mb-3 pr-16 text-[14px] font-bold text-charcoal-900">{DOC_TITLES[docId]}</p>
      <div className="mt-6 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 border-b border-sand-200 pb-0.5 text-[10px]">
            <span className="w-24 shrink-0 text-charcoal-500">{k}</span>
            <span className={typed}>{v}</span>
          </div>
        ))}
        {blanks.map((k) => (
          <div key={k} className="flex gap-2 border-b border-sand-300 pb-0.5 pt-2 text-[10px]">
            <span className="w-24 shrink-0 text-charcoal-500">{k}</span>
            <span className="text-[12px]" style={handwritten ? hand : { color: "transparent" }}>
              {handwritten ? handValues[k] ?? "" : "·"}
            </span>
          </div>
        ))}
      </div>
      <p className="absolute bottom-2 left-5 right-5 border-t border-sand-200 pt-1 font-mono text-[7.5px] text-charcoal-400">
        Printed from HDPM-OS · folder VT-118 · scan back to file automatically
      </p>
    </div>
  );
}

function PrintPreview({ docId, onConfirm }: { docId: string; onConfirm: () => void }) {
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_260px]">
      <PaperPage docId={docId} />
      <div>
        <p className="text-[15px] font-semibold text-charcoal-900">Prefilled &amp; ready to print</p>
        <p className="mt-1 text-[12.5px] text-charcoal-600">
          <span className="font-mono text-[#1b3a8a]">Blue typed fields</span> came from AppFolio and the folder. The blank lines are for the
          pen. The QR code in the corner is how the scan finds this folder later.
        </p>
        {docId === "tracking" && <p className="mt-2 text-[12px] text-charcoal-500">The confirmation-of-notice letter prints with it.</p>}
        <button onClick={onConfirm} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-3 py-2 text-[13px] font-medium text-white">
          <Printer className="h-4 w-4" /> Print (demo)
        </button>
        <p className="mt-2 text-[11px] text-charcoal-400">Nothing is actually sent to a printer.</p>
      </div>
    </div>
  );
}

function ScanBack({ docId, onConfirm }: { docId: string; onConfirm: () => void }) {
  const [scanned, setScanned] = useState(false);
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_260px]">
      {scanned ? (
        <PaperPage docId={docId} handwritten />
      ) : (
        <button
          onClick={() => setScanned(true)}
          className="flex aspect-[8.5/11] w-full max-w-[380px] flex-col items-center justify-center gap-2 justify-self-center rounded-lg border-2 border-dashed border-sand-300 bg-sand-50 text-charcoal-500 hover:bg-sand-100"
        >
          <Upload className="h-6 w-6" />
          <span className="text-[13px] font-medium">Drop a scan or photo here</span>
          <span className="text-[11px]">(click to simulate the office scanner)</span>
        </button>
      )}
      <div>
        <p className="text-[15px] font-semibold text-charcoal-900">Scan back</p>
        {!scanned ? (
          <p className="mt-1 text-[12.5px] text-charcoal-600">
            Scan the hand-written page from the office scanner or take a photo. No need to say which folder it belongs to.
          </p>
        ) : (
          <>
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-[12.5px] font-medium text-green-800">
              <ScanLine className="h-4 w-4" /> QR matched: VT-118 · {DOC_TITLES[docId]} · v1
            </p>
            {docId === "inspection" && (
              <p className="mt-2 text-[12px] text-charcoal-600">3 repairs noted on the page. Confirm and they become work orders on the back of the folder.</p>
            )}
            {docId === "tracking" && (
              <p className="mt-2 text-[12px] text-charcoal-600">The confirmation letter was scanned in the same batch and matched too.</p>
            )}
            <button onClick={onConfirm} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-3 py-2 text-[13px] font-medium text-white">
              <Check className="h-4 w-4" /> Looks right: attach to folder
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FileToAppFolio({ docs, onConfirm }: { docs: Doc[]; onConfirm: () => void }) {
  return (
    <div>
      <p className="text-[15px] font-semibold text-charcoal-900">File to AppFolio</p>
      <p className="mb-3 mt-1 text-[12.5px] text-charcoal-600">Each document goes to the right record with a standard name. Nobody picks folders by hand.</p>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-sand-200 text-left text-[10.5px] uppercase tracking-wider text-charcoal-400">
            <th className="py-1.5 pr-3 font-semibold">Document</th>
            <th className="py-1.5 pr-3 font-semibold">AppFolio record</th>
            <th className="py-1.5 font-semibold">File name</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-sand-100">
              <td className="py-1.5 pr-3 text-charcoal-900">{d.title}</td>
              <td className="py-1.5 pr-3 text-charcoal-600">
                {d.record === "Tenant record" ? "Tenant · J. Rivera (sample)" : "Property · 1420 NW Elm Ave #B"}
              </td>
              <td className="py-1.5 font-mono text-[11px] text-charcoal-500">
                2026-10-17 VT-118 {d.title.replace(/[’']/g, "").slice(0, 28)}.pdf
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11.5px] text-charcoal-400">
        First version: guided. Download with the standard name, open the AppFolio record, upload, mark filed. Automatic upload if AppFolio&apos;s
        API allows it (being confirmed).
      </p>
      <button onClick={onConfirm} className="mt-4 flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-[13px] font-medium text-white hover:bg-green-800">
        <Check className="h-4 w-4" /> Mark all filed &amp; close folder
      </button>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="relative w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-charcoal-400 hover:text-charcoal-900">
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
