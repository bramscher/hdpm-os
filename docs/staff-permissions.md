# Staff permissions

The editable roster shows active staff only and suppresses Bianca, Jayme/Jaymen, Jen, and Bryce. Historical staff records and permission audit entries are retained.

Admin → Staff permissions (`/admin/staff-permissions`) manages five capabilities: invoice drafts, invoice PDF generation, estimate drafts, estimate templates, and estimate issuing. Each setting supports Role default, On, and Off. Current role is shown; this page does not edit roles, sign-in eligibility, scheduling, invoice status/credit permissions, or estimate approval authority.

Only a currently active database administrator can change access. Administrator capabilities cannot be disabled here. Inactive staff have no effective capabilities. Changes use an optimistic version and record actor, before/after overrides, reason, and timestamp. A stale editor must refresh before retrying. Restore a previous value or Role default to reverse a change.

Invoice PDF generation requires invoice drafts. Template authoring and estimate issuing require estimate drafts. The effective value is displayed before saving. Non-office invoice authors remain limited to their own ordinary draft invoices; the PDF permission does not grant credits, deletion, duplication, or access to another author's drafts.

Permission checks reload from the database for protected API requests. Browser session display refreshes every minute and on window focus. A page refresh picks up new controls. A failed permission lookup denies the capability rather than falling back to the role; login itself remains available.

Apply `20260922_estimate_authors.sql`, then `20260922_staff_capabilities.sql` before deploying the tool. The capability migration preserves the named access already approved for Alberto, Brody, Cheryl, and Penny. It never overwrites later admin changes when replayed. All capability tables and functions are service-role-only with RLS enabled on tables.

Work & Billing, estimate creation/review, and the permissions page now use the available content width. Wide data tables retain their own horizontal scroll on narrow displays; page content is contained within the shared sidebar layout.
