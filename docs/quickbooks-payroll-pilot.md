# QuickBooks payroll feasibility pilot

The goal is to transfer approved HDPM time into QuickBooks Online so payroll can be reviewed instead of retyped. First establish whether the standard Accounting API creates usable time entries. An API success is **not** proof that the hours populate QuickBooks Online Payroll or that overtime and leave are classified correctly.

This pilot is a local CLI, not a deployed payroll integration. It does not change HDPM timecards, submit payroll, access compensation APIs, or create production entries. No new packages or database migrations are needed.

## Observed setup status — September 16, 2026

- Existing app: **HDPM Dashboard**, app ID `d374ce54-0a26-4404-be2f-2b65ceff4b30`, in **HDPM Workspace**.
- Development credentials are available. The OAuth playground can select this app's sandbox credentials and Accounting scope.
- The initial authorization attempt returned **There is no sandbox companies found for the user**.
- After the user explicitly approved the country and product, created **Sandbox Company US 7063**, realm ID `9341457928031542`, United States / QuickBooks Online Plus. The portal lists Accounting and Payments as enabled features, not Payroll. This is fictional test data, separate from HDPM's live books.
- Authorized the HDPM Dashboard app to that sandbox with the Accounting scope. Company and employee reads succeeded.
- Created and read back one exact sandbox `TimeActivity`: Emily Platt (QuickBooks employee ID `55`), 2026-09-16, 1h15m, nonbillable, description `HDPM API PILOT sandbox only / trial-1`. The entry has no `PayrollItemRef`, as expected for the basic Accounting API.
- Result: **basic time-entry API verified; payroll-preview transfer not verified**. The sandbox does not list Payroll as an enabled feature, so it cannot answer whether these entries flow into a real QBO Payroll pay run.
- Production keys are locked: the portal reports App details **0%** and Compliance **0%**. This is a separate prerequisite for testing HDPM's real payroll preview.
- Safe app metadata now saved in the Intuit dashboard: host domain and launch/disconnect/connect URLs use `hdpmchat.highdesertpm.com`, and the app category is **Team & payroll**. Regulated industries is set to **None of the above** because HDPM is an internal timekeeping tool and does not offer insurance, lending, investment advice, or payment movement.
- Remaining dashboard blockers include a public end-user license agreement URL, a public privacy policy URL, a required 100x100 JPG/PNG app logo, and geolocation details (hosting country/IP range). The assessment questionnaire is Intuit's roughly 30-minute app review; it has not been started or submitted.
- Local verification: 20 mocked API tests pass, TypeScript check passes, and offline status/payload preview run successfully. No live API write or payroll transfer has been verified.

## Connect the existing developer app

1. Open the existing HDPM app in the [Intuit developer dashboard](https://developer.intuit.com/app/developer/dashboard). The app ID supplied in this conversation identifies the app; it is not the OAuth client ID or QuickBooks company ID.
2. Start with its development credentials and a QuickBooks **sandbox company**, on the free Builder tier. Use a fictional employee already in that sandbox.
3. Use [Intuit's OAuth playground](https://developer.intuit.com/app/developer/playground) with the `com.intuit.quickbooks.accounting` scope. Follow the playground's instructions for the exact redirect URI. Complete the company authorization in Intuit. No payroll compensation scope is needed for this pilot.
4. Put the resulting short-lived access token and company realm ID into `.env.quickbooks-pilot.local` at the repository root. This filename is already ignored by Git. Do not put credentials into chat, command arguments, screenshots, or tracked files.

```dotenv
QBO_PILOT_ENVIRONMENT=sandbox
QBO_PILOT_REALM_ID=YOUR_NUMERIC_SANDBOX_COMPANY_ID
QBO_PILOT_ACCESS_TOKEN=YOUR_ACCESS_TOKEN
```

The CLI only needs the access token; client secrets and refresh tokens stay out of this pilot. When the token expires, obtain another through Intuit's playground. This intentionally avoids building permanent OAuth storage before feasibility is established. Shell environment variables take precedence over the local file.

## Run the probe

```sh
node scripts/quickbooks-payroll-pilot.mjs status
node scripts/quickbooks-payroll-pilot.mjs probe
```

`status` is offline and shows only whether configuration is present. `probe` reads the company name and the first 100 active employees' names and IDs. Verify the company before creating a test entry. The output may contain employee names; keep it local.

Preview one fictional entry, replacing the employee ID and date with your sandbox test values:

```sh
node scripts/quickbooks-payroll-pilot.mjs preview --employee-id 12 --date 2026-09-16 --minutes 75 --run-id trial-1
```

The preview performs no network requests. It represents 1 hour 15 minutes of nonbillable time with a test marker. It does not set pay rates, payroll categories, customers, leave, stipend amounts, or mileage.

Create it in the sandbox only, replacing `12345` with that sandbox's realm ID:

```sh
node scripts/quickbooks-payroll-pilot.mjs create-sandbox --employee-id 12 --date 2026-09-16 --minutes 75 --run-id trial-1 --confirm-company 12345
```

The script checks the employee is active, sends one entry, then separately reads it back and compares employee, date, duration, description, billable status, and absence of a payroll category. Exact retries use the same Intuit request ID. Keep **all inputs unchanged**, including run ID, when retrying; changing inputs produces a different request. This is not a permanent duplicate ledger for production payroll.

If read-back fails after creation, the error gives the activity ID. Inspect it without creating another entry:

```sh
node scripts/quickbooks-payroll-pilot.mjs read --activity-id 98
```

The test entry remains in the sandbox for inspection. Clean it up in the sandbox UI after review if desired. No automatic deletion occurs.

## What constitutes success

| Check | What it proves |
| --- | --- |
| Company and employee reads succeed | The app's Accounting API authorization works. |
| One sandbox time entry is created and read back | The basic TimeActivity payload works. |
| An authorized, controlled production pilot shows the exact hours on the payroll preview | This company's payroll actually consumes the entries. This remains a separate required check. |
| Regular, overtime, emergency premium, leave, stipend and mileage reconcile | The chosen workflow reduces payroll work without losing or duplicating pay inputs. |

The script always reports `payrollPreviewVerified: false`: it cannot inspect or infer the payroll preview from an Accounting API response. Sandbox success alone cannot establish production payroll support. To inspect the real company's read access, authorize that company using production credentials and set `QBO_PILOT_ENVIRONMENT=production`; only `probe` and `read` can contact it. The app ID and sandbox authorization do not authorize the real company.

Before adding a production write path, prepare one actual approved employee/day, confirm the destination and exact entry, check for existing entries (including bookkeeper entries), and arrange inspection of the payroll preview without submitting payroll. The free pilot must not flatten overtime, emergency premiums, or leave into regular hours. Salary, stipend and mileage treatment require separate verification. No live time or payroll has been sent by adding these files.

## Follow-on integration, only after the payroll check

Use saved approved HDPM payroll snapshots as the source. Match each HDPM employee to an explicit QuickBooks employee ID; HDPM's current payroll ID must not be assumed to be that ID. Add secure OAuth token storage/refresh, admin-only preview/send actions, persistent per-entry sync records, reconciliation, and correction handling. Retain the Excel audit package. Final payroll submission stays with the reviewer.

## References

Checked September 16, 2026:

- [TimeActivity API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/timeactivity): basic employee time creation; `PayrollItemRef` is part of paid Payroll Compensation access.
- [Intuit Time API and Payroll Compensation explanation](https://medium.com/intuitdev/powerful-time-payroll-tracking-with-the-time-api-payroll-compensation-552b7b01a247): pay-type-aware integration and its limitations.
- [Partner program guide](https://static.developer.intuit.com/resources/Intuit_App_Partner_Program_Guide.pdf): free Builder access versus paid premium access.

Run local verification with `npx vitest run lib/__tests__/quickbooks-pilot.test.ts`. These tests mock QuickBooks responses; they do not constitute a live API or payroll test.
