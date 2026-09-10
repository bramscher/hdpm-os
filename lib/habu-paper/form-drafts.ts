import { ORIGINAL_TEXT } from './source-text';
import { TEMPLATES, type FormKind } from './model';

export type DraftField = { id: string; label: string; type: 'text' | 'date' | 'time' | 'number' | 'money' | 'check' | 'long' | 'choice'; options?: string[]; initial?: string };
export type DraftSection = { title: string; fields: DraftField[]; note?: string; column?: 'left' | 'right' };
export type FormDraft = { id: string; title: string; family: 'Application & setup' | 'Move-in' | 'Vacancy'; source: string; review: string[]; sections: DraftSection[]; workflow?: FormKind };
const f = (id: string, label: string, type: DraftField['type'] = 'text', initial?: string): DraftField => ({ id, label, type, initial });
const checks = (prefix: string, labels: string[]) => labels.map((label, i) => f(`${prefix}-${i}`, label, 'check'));
const amounts = (prefix: string, labels: string[]) => labels.map((label, i) => f(`${prefix}-${i}`, label, 'money'));
const choice = (id: string, label: string, options = ['Yes', 'No', 'Not applicable']): DraftField => ({ id, label, type: 'choice', options });
const identity = (): DraftSection => ({ title: 'Property and household', fields: [f('property', 'Property code / number'), f('address', 'Property address'), f('names', 'Tenant / applicant names'), f('date', 'Date', 'date')] });
const people = (prefix: string, count: number, labels: string[]) => Array.from({ length: count }, (_, i) => ({ title: `${prefix} ${i + 1}`, fields: labels.map((label, j) => f(`${prefix}-${i}-${j}`, label)) }));
const signatures = (count = 2, person = 'Tenant'): DraftSection => ({ title: 'Signature spaces', note: 'Layout placeholders only. Typing here does not execute or submit this document.', fields: Array.from({ length: count }, (_, i) => [f(`signature-${i}`, `${person} ${i + 1} — signature placeholder`), f(`signed-${i}`, 'Date', 'date')]).flat() });
const leaseType = () => choice('lease-type', 'Rental agreement', ['Month-to-month', 'Fixed term']);
const master = (kind: FormKind): FormDraft => ({
  id: kind === 'vacancy' ? 'vacancy-tracking' : 'new-tenant-setup', title: TEMPLATES[kind].title,
  family: kind === 'vacancy' ? 'Vacancy' : 'Application & setup', workflow: kind,
  source: kind === 'vacancy' ? 'AF - Vacancy Tracking-Gold In House Form.pdf; IMG_1813.JPG' : 'AF - New Tenant Set-up Form.pdf; IMG_1811.JPG',
  review: ['Blank draft of the existing demo sheet. Editing this template preview does not change any workflow case or inbox.'],
  sections: [{ title: 'Header', fields: TEMPLATES[kind].header.map(row => ({ ...row, type: row.type === 'task' ? 'check' as const : row.type })) }, ...TEMPLATES[kind].sections.filter(s => s.column !== 'back').map(s => ({ title: s.label, column: s.column as 'left' | 'right', fields: s.rows.map(row => ({ ...row, type: row.type === 'task' ? 'check' as const : row.type })) }))],
});

const householdSupplement: DraftSection[] = [identity(),
  ...people('Applicant', 4, ['Name']),
  ...people('Animal', 2, ['Animal name', 'Type / breed', 'Belongs to']),
  ...people('Vehicle', 4, ['Tenant name', 'Make', 'Model', 'Color', 'License plate', 'Year']),
  ...people('Emergency contact', 4, ['Name', 'Address', 'Phone number', 'Applicant name', 'Relationship']),
];

const cotenant: FormDraft = {
  id: 'co-tenant-setup', title: 'Co-Tenant Set-up Form', family: 'Application & setup', source: 'IMG_1811.JPG — center setup sheet',
  review: ['Checklist checked against the OneDrive original. Confirm assignment owners and release rules before connecting this draft to staff inboxes.'],
  sections: [{ title: 'Header', fields: [leaseType(), f('term-end', 'Fixed term end date', 'date'), f('started', 'Date started', 'date'), f('rentzap', 'Received — Rent Zap', 'date'), f('pm-date', 'Date to PM', 'date'), ...identity().fields.filter(x => x.id !== 'date')] },
    ...people('Co-tenant', 3, ['Name', 'Phone']),
    { title: 'Set-up checklist', column: 'left', fields: [
      ...checks('ct-setup', ['Sent email for request to add', 'Received tenants’ authorization / request to send', 'Created & sent application link', 'Calls to applicant', 'Deactivate Rentzap listing']),
      f('appointment', 'Move-in scheduled for', 'date'),
      ...checks('ct-records', ['Send Information Form', 'Send portal activation link', 'Add to TNT page / attach evaluation sheet', 'Charge security deposit', 'Email CCRs to co-tenant', 'Information Form received', 'Apply deposit funds']),
      choice('assist-animal', 'Assistance animal (household)'), choice('animal-addendum', 'Animal addendum (household)'),
      ...checks('ct-agreement', ['Utility addendum', 'Rental agreement prepared & emailed']),
    ] },
    { title: 'Move-in', column: 'right', fields: [...checks('ct-movein', ['Enter co-tenant insurance']), ...amounts('ct-deposit', ['Co-tenant deposit', 'Pet deposit', 'Total deposits'])] },
    { title: 'Due at move-in', column: 'right', fields: amounts('ct-due', ['Security deposit', 'Pet rent', 'Total']) },
    { title: 'After move-in', column: 'right', fields: checks('ct-after', ['Scan & attach all documents to tenant page']) },
  ],
};

const acquired: FormDraft = {
  id: 'acquired-tenant-setup', title: 'Acquired Tenant Set-up Form', family: 'Application & setup', source: 'IMG_1811.JPG — right setup sheet',
  review: ['Photo heading is spelled “Aquired”; the draft corrects that spelling. Confirm transfer/deposit handling and role assignments with staff.'],
  sections: [identity(), ...people('Tenant', 3, ['Name', 'Phone']), { title: 'Owner', fields: [f('owner', 'Owner name'), f('city', 'City'), f('zip', 'ZIP')] },
    { title: 'Received rental documents', column: 'left', fields: [...checks('ac-docs', ['Received rental documents']), f('current-agreement', 'Current rental agreement — reference'), f('increase-notices', 'Rent increase notices — reference'), f('condition-record', 'Move-in condition — reference'), f('deposit-funds', 'Security deposit funds', 'money')] },
    { title: 'Set-up checklist', column: 'left', fields: [...checks('ac-setup', ['Start move-in process in AppFolio', 'Send email with Tenant Information Form', 'Enter all tenant information — children', 'Enter all tenant information — pets', 'Enter all tenant information — vehicles', 'Emergency contact', 'Copy of photo ID', 'Security deposit charges in AppFolio', 'Utility tags on property page', 'Utility addendum', 'Pet agreement if needed', 'Assistance animal agreement if needed']), leaseType()] },
    { title: 'Move-in / transfer', column: 'right', fields: checks('ac-transfer', ['Rental agreement prepared & emailed', 'Receipt of deposits', 'Renters insurance', 'Verify City of Redmond services']) },
    { title: 'Due at move-in — from management company / owner', column: 'right', fields: amounts('ac-due', ['Security deposit', 'Prorated rent', 'Pet rent', 'Total']) },
    { title: 'After move-in', column: 'right', fields: checks('ac-after', ['Review tenant information', 'Enter insurance information', 'Change date of inspection on property page', 'Scan tenant information']) },
  ],
};

const tenantInfo: FormDraft = {
  id: 'tenant-information', title: 'Acquired Tenant Information Form', family: 'Application & setup', source: 'IMG_1811.JPG — lower center',
  review: ['Sensitive identifier spaces are represented as reference placeholders. Use fictional values in this owner-only draft; collection and storage are not implemented.'],
  sections: [identity(), ...people('Tenant', 4, ['Name', 'Home phone', 'Work phone', 'Cell phone', 'Email', 'SSN — secure record reference only', 'ODL — secure record reference only', 'Birth date — placeholder']),
    { title: 'Other household members', fields: [f('members', 'Names and dates of birth — placeholder', 'long')] },
    { title: 'Pets', fields: [f('pets', 'Breed, name, weight & age', 'long')] },
    ...people('Vehicle', 5, ['Make & model', 'Color', 'License plate', 'Year']),
    ...people('Emergency contact', 2, ['Name', 'Phone number', 'Relationship']),
    { title: 'Supporting documents', note: 'The photographed form asks for photo ID and renter’s insurance. No uploads are collected in this demo.', fields: [f('id-reference', 'Photo ID — document reference'), f('insurance-reference', 'Renter’s insurance — document reference')] },
  ],
};

const deposit: FormDraft = {
  id: 'deposit-to-hold', title: 'Deposit to Hold Agreement', family: 'Application & setup', source: 'IMG_1811.JPG — bottom sheet (partly outside frame)',
  review: ['Complete disclosure, fee and agreement wording recovered from the OneDrive original. This is a transcription for review, not a determination that the terms are current or enforceable.', 'The source prints an $800 deposit and several preset fees. Amount fields remain blank; confirm the applicable values before use.'],
  sections: [identity(), { title: 'Rental details', column: 'left', fields: [f('city', 'City'), f('state', 'State'), f('zip', 'ZIP'), f('received', 'Deposit to hold received', 'money'), f('monthly-rent', 'Monthly rent', 'money'), f('movein', 'Move-in date', 'date'), leaseType(), f('term-end', 'Fixed term end date', 'date')] },
    { title: 'Move-in amounts', column: 'right', fields: amounts('hold-due', ['Security deposit', '1st month’s rent', '2nd month’s rent (if applicable)', '1st month’s animal rent', '2nd month’s animal rent', 'Subtotal', 'Minus deposit to hold', 'Total due at move-in']) },
    { title: 'Disclosures', fields: [choice('insurance', 'Renter’s insurance requirement', ['Required per approved agreement', 'Not required per approved agreement', 'Needs review']), f('insurance-terms', 'Insurance disclosure — source wording', 'long', ORIGINAL_TEXT.insurance), choice('hoa', 'HOA / COA move-in or move-out fees apply'), f('hoa-terms', 'Hoa disclosure — source wording', 'long', ORIGINAL_TEXT.hoa), choice('mailbox', 'Locking mailbox applies'), f('mailbox-terms', 'Mailbox disclosure — source wording', 'long', ORIGINAL_TEXT.mailbox), choice('utility', 'Monthly utility charge applies'), f('utility-terms', 'Utility disclosure — source wording', 'long', ORIGINAL_TEXT.utility)] },
    { title: 'Non-compliance fees', note: 'Transcribed source wording — requires current-form review before use.', fields: [f('fees', 'Source fee schedule', 'long', ORIGINAL_TEXT.fees)] },
    { title: 'Agreement', note: 'Complete wording from the OneDrive original; retained for internal review.', fields: [f('agreement', 'Agreement text', 'long', ORIGINAL_TEXT.depositAgreement)] }, signatures(4, 'Applicant'), { title: 'Management signature space', fields: [f('management-signature', 'High Desert Property Management — signature placeholder'), f('management-date', 'Date', 'date')] },
  ],
};

const intro: FormDraft = {
  id: 'deposit-introduction-letter', title: 'Deposit to Hold / Welcome Letter', family: 'Application & setup', source: 'IMG_1812.JPG — upper letter',
  review: ['Draft follows the photographed letter with household dates, amounts and payment instructions left as placeholders. Confirm the current office instructions before use.'],
  sections: [identity(), { title: 'Letter', fields: [f('body', 'Editable letter draft', 'long', `Hello [tenant first names],

Thank you for choosing to rent from High Desert Property Management. Please review the following information regarding your rental agreement and upcoming move-in.

FORMS AND DEPOSIT
A Tenant Information Form and Deposit to Hold Form have been emailed to you for review, completion, and signature. Both forms and the [deposit amount] deposit to hold are due by [time] on [date].
Please make payment to [payee] using [approved payment methods]. [Insert the current delivery and mailing instructions.]

MOVE-IN APPOINTMENT
Your appointment is scheduled for [date and time] at [office / appointment address], unless instructed otherwise.

RENTAL AGREEMENT
Once we receive the completed forms and deposit, you will receive an email notifying you that your rental agreement is ready to sign. Please read each page carefully, initial where required, and complete the signature process.

If you have any questions, please contact [office contact].`)] }],
};

const appointment: FormDraft = {
  id: 'move-in-letter', title: 'Move-in Appointment / Preparation Letter', family: 'Move-in', source: 'IMG_1812.JPG — middle letter',
  review: ['The photo contains household-specific funds, dates and insurance language. They are placeholders here, not defaults. The office-hours line is incomplete in the source.'],
  sections: [identity(), { title: 'Letter', fields: [f('body', 'Editable letter draft', 'long', `Hello [tenant first names],

A rental agreement has been sent to your tenant portal for review and signature. Please log in to complete it, following the initial and signature instructions.

Your move-in appointment is scheduled for [date] at [time], at [appointment location]. To receive your keys, please complete the following items:

1. MOVE-IN FUNDS
Remainder of security deposit: [amount].
Prorated rent for [period]: [amount].
[Insert approved payment methods and whether separate payments are required.]

2. RENTER’S INSURANCE
[Insert the insurance requirement applicable to this household.]
[Insert approved declaration-page, insured-person and interested-party instructions.]

3. UTILITIES
Arrange the utilities required by your rental agreement, effective [move-in date]. Provide confirmation using [approved office channel]. Utility providers and contact details: [insert applicable providers].

Please contact [office contact] during [confirmed office hours] with questions.`)] }],
};

function moveinChecklist(co: boolean): FormDraft {
  return { id: co ? 'co-tenant-checklist' : 'new-tenant-checklist', title: co ? 'Co-Tenant’s Checklist' : 'New Tenant’s Checklist', family: 'Move-in', source: 'IMG_1812.JPG — lower checklists',
    review: ['Both original checklists were recovered in full. Acknowledgment text and lease references are transcribed from the source; initials below are draft placeholders, not executed acknowledgments.'],
    sections: [identity(), { title: 'Items received', fields: [...checks('received', ['Copy of rental agreement', 'CCRs sent']), ...(!co ? [f('keys', 'Keys issued'), f('garage-remotes', 'Garage door remotes issued')] : [])] },
      { title: 'Insurance and utilities', fields: [f('insurance', 'Renter’s insurance information'), ...(!co ? ['Water', 'Sewer', 'Garbage', 'Electric', 'Natural gas'].map((x, i) => f(`utility-${i}`, x + ' — provider / confirmation')) : []), f('other', 'Other')] },
      { title: 'Acknowledgments', note: 'Source wording; confirm the current lease references and instructions before use.', fields: ORIGINAL_TEXT.acknowledgments.map((text, i) => f(`ack-${i}`, `${text} — Initials`)) }, signatures()],
  };
}

const condition: FormDraft = {
  id: 'move-in-condition', title: 'New Tenant Inspection Form', family: 'Move-in', source: 'OneDrive original — two pages',
  review: ['Includes both source pages: the dining room, three bedrooms, three bathrooms, propane level, notes and signature spaces are now included.', 'Source says “CO2 Alarms”; the draft labels these carbon monoxide (CO) alarms for review. This is a condition record and creates no repair request.'],
  sections: [identity(), { title: 'Return details', note: 'THIS IS NOT A REPAIR REQUEST', fields: [f('movein', 'Move-in date', 'date'), f('due', 'Due date', 'date'), f('condition-statement', 'Source return instructions and acknowledgment', 'long', 'This form MUST be returned to High Desert Property Management within 7 days of move-in date.\n\nTenant has inspected the premises and states that the premises are in satisfactory condition, free of defects, except as noted below.')] },
    ...Object.entries({"Front entrance": ["Front door / locks", "Entry flooring", "Light fixtures"], "Living room": ["Window / screen", "Light fixtures", "Switch / outlet plates", "Walls", "Woodworking / molding", "Heater", "Carpet / flooring", "Stove / fireplace", "Slider screen"], "Laundry room": ["Washer / dryer", "Countertop / sink", "Carpet / flooring", "Other"], "Kitchen": ["Window / screen", "Light fixtures", "Switch / outlet plates", "Walls", "Woodworking / molding", "Flooring", "Refrigerator", "Sink / disposal", "Range / oven", "Microwave", "Countertop", "Dishwasher", "Cupboards / drawers"], "Dining room": ["Window / screen", "Light fixtures", "Switch / outlet plate", "Walls", "Woodwork / molding", "Carpet / flooring"], "Garage": ["Garage doors", "Garage opener", "Light fixtures", "Walls", "Woodworking / molding", "Flooring"], "Exterior": ["Lawn", "Shrubs", "Driveway", "Light fixture", "Porch / deck", "Patio"], "Master bedroom": ["Window / screen", "Light fixtures", "Switch / outlet plates", "Walls", "Carpet / flooring", "Heater", "Door / doorstop", "Closet"], "Bedroom 1": ["Window / screen", "Light fixtures", "Switch / outlet plates", "Walls", "Carpet / flooring", "Heater", "Door / doorstop", "Closet"], "Bedroom 2": ["Window / screen", "Light fixtures", "Switch / outlet plates", "Walls", "Carpet / flooring", "Heater", "Door / doorstop", "Closet"], "Master bath": ["Light fixtures", "Switch / outlet plates", "Walls", "Ventilation fan", "Flooring", "Bath / shower", "Toilet / caulking", "Mirrors", "Sink / vanity", "Cupboards", "Door / doorstop", "Towel bars"], "Bathroom 1": ["Light fixtures", "Switch / outlet plates", "Walls", "Ventilation fan", "Flooring", "Bath / shower", "Toilet / caulking", "Mirrors", "Sink / vanity", "Cupboards", "Door / doorstop", "Towel bars"], "Bathroom 2": ["Light fixtures", "Switch / outlet plates", "Walls", "Ventilation fan", "Flooring", "Bath / shower", "Toilet / caulking", "Mirrors", "Sink / vanity", "Cupboards", "Door / doorstop", "Towel bars"]}).map(([title, labels], i) => ({ title, fields: labels.map((label, j) => f(`condition-${i}-${j}`, label + ' — condition / notes')) })),
    { title: 'Smoke & carbon alarms', fields: [f('smoke-count', 'Number of smoke alarms', 'number'), f('co-count', 'Number of carbon monoxide (CO) alarms', 'number'), f('combo-count', 'Number of combination alarms', 'number')] },
    { title: 'Additional details', fields: [f('propane', 'If applicable — propane tank level on day of move-in'), f('additional', 'Additional notes', 'long')] }, signatures(4), { title: 'Management signature space', fields: [f('management-signature', 'Property management — signature placeholder'), f('management-date', 'Date', 'date')] },
  ],
};

const notice: FormDraft = {
  id: 'notice-to-vacate', title: 'Tenant’s 30 Day Notice to Vacate the Premises', family: 'Vacancy', source: 'IMG_1813.JPG — upper sheet',
  review: ['Full text recovered from the OneDrive master dated 08/2020. Wording is reproduced for internal review, including the personal-property clause; its legal validity has not been assessed.', 'The draft does not calculate a notice period or charges. Confirm the currently approved version before tenant use.'],
  sections: [identity(), { title: 'Contact and move-out details', fields: [f('home-phone', 'Home phone'), f('work-phone', 'Work phone'), f('cell-phone', 'Cell phone'), f('reason', 'Reason for leaving'), f('vacate-date', 'Intended vacate date', 'date'), f('received-date', 'Date notice received by office', 'date')] },
    { title: 'Notice', fields: [f('approved-terms', 'Notice terms — source wording', 'long', ORIGINAL_TEXT.noticeTerms)], note: 'Source transcription with [vacate date] as an editable text placeholder. No deadlines are calculated here.' },
    { title: 'Utilities paid by tenant', fields: checks('utility', ['Water', 'Sewer', 'Garbage', 'Electric', 'Natural gas']) },
    { title: 'Forwarding address', fields: [f('forwarding', 'Forwarding address'), f('forwarding-city', 'City / state / ZIP')] }, signatures(4)],
};

const confirmation: FormDraft = {
  id: 'notice-confirmation', title: 'Confirmation of 30 Day Notice to Vacate', family: 'Vacancy', source: 'IMG_1813.JPG — lower letter',
  review: ['The source offers three alternative date paragraphs. This draft uses a selected scenario plus reviewable text, so conflicting paragraphs are not automatically sent.', 'Notice-period, rent, fee and accounting-deadline language requires the approved source. No amounts or deadlines are calculated.'],
  sections: [identity(), { title: 'Notice received', fields: [f('notice-date', 'Notice dated', 'date'), f('received', 'Received on', 'date'), f('method', 'Delivery method'), choice('scenario', 'Date scenario', ['Vacate date provided', 'No vacate date provided', 'Notice period needs review']), f('requested-vacate', 'Requested vacate date', 'date'), f('confirmed-date', 'Reviewed move-out date', 'date')] },
    { title: 'Reviewed charges', fields: [f('period', 'Charge period'), ...amounts('confirmation-money', ['Prorated / monthly charge', 'Delinquent charges', 'Early termination fee'])] },
    { title: 'Letter', fields: [f('body', 'Editable letter draft', 'long', `Dear [tenant names],

High Desert Property Management acknowledges receipt of your notice to vacate dated [notice date], received by [delivery method] on [receipt date].

[Insert the reviewed paragraph for the selected date scenario and the confirmed move-out date.]

Charges for [period]: [reviewed amount]. Outstanding charges: [amount]. Any applicable early termination fee: [reviewed amount and approved basis].

WHEN YOU MOVE
Please confirm your actual departure date and time with our office. Follow the approved utility and key-return instructions below:
[Insert utility closing-bill instructions.]
[Insert key, garage remote and after-hours return instructions.]
Clean the premises and provide one forwarding address for correspondence and deposit accounting.

[Insert the current approved payment, automatic-payment and final-accounting wording.]

Questions: [office contact].`)] }],
};

export const FORM_DRAFTS: FormDraft[] = [
  { id: 'application-summary', title: 'Application Summary', family: 'Application & setup', source: 'IMG_1811.JPG — RentZap summary at top', review: ['This is a reference-copy layout of the RentZap output, not a replacement screening decision or evaluation. No personal details from the photo are copied.'], sections: [
    { title: 'Application', fields: [f('prepared-for', 'Prepared for'), f('application-id', 'Application ID'), f('status', 'Status from source'), f('updated', 'Last updated', 'date'), f('listing', 'Listing'), f('lease-start', 'Lease start date', 'date'), f('source-reference', 'RentZap record reference')] },
    ...people('Applicant', 3, ['Full name', 'Date of birth — placeholder', 'Phone', 'Email']),
    { title: 'Minors', fields: [f('minors', 'Household members — placeholder', 'long')] },
    ...people('Vehicle', 3, ['Make', 'Model', 'Year', 'Color', 'Plate']), ...people('Animal', 3, ['Name', 'Type', 'Breed', 'Assistive status from source']),
  ] },
  master('setup'), cotenant, acquired,
  { id: 'household-supplement', title: 'Move In — New Tenant Information Form', family: 'Application & setup', source: 'IMG_1811.JPG — lower left information sheet', review: ['Original title and four applicant spaces recovered from OneDrive.', 'Emergency-contact note says one per applicant and someone not living in the unit.'], sections: householdSupplement },
  tenantInfo, deposit, intro, appointment, moveinChecklist(false), moveinChecklist(true), condition, notice, master('vacancy'), confirmation,
];

const ONEDRIVE_SOURCES: Record<string, string> = {
  "co-tenant-setup": "General/Tenant Forms/Forms - Tenant Move-In/AF - New CO-Tenant Set Up Form - In House Form.pdf",
  "acquired-tenant-setup": "General/Tenant Forms/Forms - Tenant Move-In/AF - Acquired TNT Set Up Form - In House Form.pdf",
  "new-tenant-checklist": "General/Tenant Forms/Forms - Tenant Move-In/AF - New Tenant Checklist - Used at Move In Physical Document.pdf",
  "co-tenant-checklist": "General/Tenant Forms/Forms - Tenant Move-In/AF - Co-Tenant Checklist - Used at Move In Physical Document.pdf",
  "move-in-condition": "General/Tenant Forms/Forms - Tenant Move-In/AF - New Tenant Inspection Form - Use in Resident Form.pdf",
  "deposit-to-hold": "General/Tenant Forms/Forms - Tenant Move-In/RF - DEPOSIT TO HOLD AGREEMENT Use in Resident Forms.pdf",
  "household-supplement": "General/Tenant Forms/Forms - Tenant Move-In/RF - New Tenant Information Form-Move In - Use in Resident Forms.pdf",
  "notice-to-vacate": "General/Tenant Forms/Forms - Tenant Move Out/RF - 30 Day Notice From Tenant Use in Resident Forms.pdf",
  "vacancy-tracking": "General/Tenant Forms/Forms - Tenant Move Out/AF - Vacancy Tracking-Gold In House Form.pdf",
  "new-tenant-setup": "General/Tenant Forms/Forms - Tenant Move-In/AF - New Tenant Set-Up Form - In House Form.pdf",
  "tenant-information": "General/Tenant Forms/Forms - Tenant Move-In/RF - Acquired Tenant Information Form - Use in Resident Forms.pdf"
};
for (const form of FORM_DRAFTS) {
  if (ONEDRIVE_SOURCES[form.id]) form.source = ONEDRIVE_SOURCES[form.id];
  if (form.id === 'new-tenant-setup') form.review.push('OneDrive contains a 4/1/2025 version; this draft retains the previously supplied 8/13/2026 version. Differences include Pending Application to Marketing and Additional Deposit versus Pet Deposit. Confirm which master to adopt.');
}

export type DraftValues = Record<string, string>;
export function initialDraftValues(form: FormDraft): DraftValues {
  return Object.fromEntries(form.sections.flatMap(s => s.fields).map(field => [field.id, field.initial || '']));
}

export function draftMarkdown(form: FormDraft, values: DraftValues): string {
  return [`# ${form.title}`, '**DRAFT — for internal review. Not an executed or approved document.**', `Source: ${form.source}`, ...form.review.map(note => `Review: ${note}`), ...form.sections.flatMap(section => [
    `## ${section.title}`, ...(section.note ? [section.note] : []), ...section.fields.map(field => field.type === 'check' ? `- [${values[field.id] === 'checked' ? 'x' : ' '}] ${field.label}` : `**${field.label}:** ${values[field.id] || '________________'}`),
  ])].join('\n\n') + '\n';
}
