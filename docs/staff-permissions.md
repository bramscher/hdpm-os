# Staff permissions

The editable roster shows active staff only and suppresses Bianca, Jayme/Jaymen, Jen, and Bryce. Historical staff records and permission audit entries are retained.

Admin → Staff permissions (`/admin/staff-permissions`) manages five capabilities: Create and edit invoices, invoice PDF generation, estimate drafts, estimate templates, and estimate issuing. Each setting supports Role default, On, and Off. Current role is shown; this page does not edit roles, sign-in eligibility, scheduling, invoice status/credit permissions, or estimate approval authority.

Only a currently active database administrator can change access. Administrator capabilities cannot be disabled here. Inactive staff have no effective capabilities. Changes use an optimistic version and record actor, before/after overrides, reason, and timestamp. A stale editor must refresh before retrying. Restore a previous value or Role default to reverse a change.

Create and edit invoices controls both the pencil and the save API for shared ordinary invoices, regardless of author, including draft, generated and attached records. PDF generation is a separate capability that requires invoice editing; disabling PDF generation does not hide the pencil. Saved corrections to generated or attached invoices clear the PDF and return the invoice to draft, requiring a new PDF and replacement in AppFolio if previously uploaded. Voided invoices, credits, and approved-workspace invoices remain protected for non-office staff. Credits, deletion, duplication and arbitrary lifecycle changes remain office-only. Template authoring and estimate issuing require estimate drafts. The effective value is displayed before saving.

Permission checks reload from the database for protected API requests. Browser session display refreshes every minute and on window focus. A page refresh picks up new controls. A failed permission lookup denies the capability rather than falling back to the role; login itself remains available.

Apply `20260922_estimate_authors.sql`, then `20260922_staff_capabilities.sql` before deploying the tool. The capability migration preserves the named access already approved for Alberto, Brody, Cheryl, and Penny. It never overwrites later admin changes when replayed. All capability tables and functions are service-role-only with RLS enabled on tables.

Work & Billing, estimate creation/review, and the permissions page now use the available content width. Wide data tables retain their own horizontal scroll on narrow displays; page content is contained within the shared sidebar layout.

On September 23, 2026, shared invoice editing was enabled and verified for the current visible staff roster: Alberto, Ashley, Brody, Cheryl, Craig, Kennedy, Matt and Penny. Existing PDF and estimate settings were preserved. Hidden/departed identities were not re-enabled. No database migration was needed; the existing `invoice.draft` setting now controls shared invoice creation/editing.
