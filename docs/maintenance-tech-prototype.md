# Maintenance technician clickable prototype

Open `/prototypes/maintenance-tech.html` in the HDPM app, or serve
`public/prototypes` with a local static server. The deployed app keeps its
existing sign-in requirements.

## Walkthrough

1. Open a job from **My Day** and start the timer.
2. Set tasks to Done, Part done, or Blocked.
3. Choose **Finish visit**, confirm the performed date and actual minutes,
   and add notes, materials, and an optional illustrated demo photo.
4. Submit for office review. **My Time** shows the actual job time.
5. Switch to **Office review**. Return a question, or add the completed
   tasks to a sample invoice draft. Unfinished tasks remain excluded.
6. Use **Reset demo** to start again.

The three jobs, addresses, and task prices are fictional. Entries are stored
only in this browser under `hdpm-field-clickable-v1`. No backend, timecard,
invoice, payment, camera, file upload, or messaging integration is connected.
Use fictional information when testing. Browser storage can be cleared with
Reset demo.

## Design boundaries

- Actual job time remains separate from service value divided by the $95
  benchmark. Materials do not contribute to equivalent service hours.
- Technician entry and office review share one demo screen; these are not
  production roles or permissions.
- The concept supports one submitted visit per sample job, with correction
  and resubmission when the office returns a question. Multiple visits,
  partial quantities, live scheduling, payroll integration, and real pricing
  are implementation work described in `invoice-manager-plan.md`.
- The timer follows elapsed wall time, including while the page is closed.
  The technician confirms actual minutes before submitting.

## Verification

Checked in Chrome at desktop and 390 × 844 phone dimensions: timer start and
pause, task updates, required blocked-work notes, submission persistence on
reload, office question and resubmission, draft creation, and separate actual
time and service-value totals. A 90-minute visit with two completed sample
tasks produces $220 service value and $12 materials: $232 total, 2.3 equivalent
service hours, and 1 hour 30 minutes of actual job time. Native iPhone testing
and backend integration are not included in this prototype.
