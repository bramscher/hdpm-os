export const CAPABILITIES = [
 {key:'invoice.draft',label:'Create and edit invoice drafts',description:'Prepare invoices from work orders. Staff can edit their own unissued drafts.'},
 {key:'invoice.generate',label:'Generate invoice PDFs',description:'Generate a PDF from an allowed invoice draft. Requires invoice drafts.'},
 {key:'estimate.draft',label:'Create and edit estimates',description:'Add scope, line items, pricing details, and save shared drafts.'},
 {key:'estimate.template',label:'Create and revise templates',description:'Save reusable estimate templates and publish revisions. Requires estimate drafts.'},
 {key:'estimate.issue',label:'Issue estimates',description:'Create the priced estimate version; existing approval rules still apply. Requires estimate drafts.'},
] as const;
export type Capability = typeof CAPABILITIES[number]['key'];
export type Capabilities = Record<Capability, boolean>;
export function roleCapabilities(role?: string): Capabilities {
 const office=['admin','maintenance','pm','manager'].includes(role||'');
 return {'invoice.draft':office||role==='finance'||role==='field','invoice.generate':office||role==='finance','estimate.draft':office,'estimate.template':office,'estimate.issue':office};
}
export function effectiveCapabilities(role: string, active: boolean, overrides: Partial<Capabilities>): Capabilities {
 const result=roleCapabilities(role);
 for(const {key} of CAPABILITIES)result[key]=active && (role==='admin'||(overrides[key]??result[key]));
 result['invoice.generate'] &&= result['invoice.draft'];
 result['estimate.template'] &&= result['estimate.draft'];
 result['estimate.issue'] &&= result['estimate.draft'];
 return result;
}
