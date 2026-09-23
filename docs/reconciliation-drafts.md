# Save and resume reconciliation

In Work & Billing → Reconcile, choose **New reconciliation**. The saved draft is named with its creation date and Pacific-time timestamp.

One current draft is stored for each signed-in employee. It saves the date range, checked invoice IDs, search and filter settings, sort order, and unfinished payment fields (including amount, date, reference, and memo). Changing the date range no longer switches drafts. The selected invoices are read fresh when resumed so corrected invoice values appear.

Wait for **Saved [timestamp]**, or use **Save and close** before leaving. Resume from the saved card without re-entering the date range. Saving does not record a payment. Errors display **Not saved** with a retry option; competing edits in another tab require a reload rather than silently overwriting the saved draft.

Recording a payment retains the saved draft as a reference and removes its payment action to avoid submitting it again. Only **Delete draft** or confirming **New reconciliation** removes/replaces the current draft. Neither action deletes invoices or recorded payments.

Storage uses a reserved key in the existing `hdms_reconcile_selection` table. No new migration is required. Old per-period selection rows are retained in storage. They are not automatically merged into the new workspace. The new API scopes every query to the authenticated staff email and checks a revision on writes/deletes.

The active reconciliation picker excludes invoices already linked to payments and voided invoices, including stale selections restored from a draft. Unapplied credits remain eligible. Recorded drafts retain their reference view. The payment dialog also excludes linked invoices from its totals and submission on every entry path. Fully applied/over-applied payments are not offered; an existing payment must be chosen explicitly (or restored if still open). If none remain available, the dialog opens New payment with no assumed payment amount.
