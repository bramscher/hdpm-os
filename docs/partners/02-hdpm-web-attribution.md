# hdpm-web companion task — referral attribution (Batch 3)

This is the **only cross-repo piece** of Batch 3. HDPM-OS owns the receiving
endpoint (`POST /api/intake/referral-lead`, already built); **hdpm-web** (the
`highdesertpm.com` marketing site) needs a small change to capture attribution
and post owner-inquiry leads to it. Hand this doc to whoever owns hdpm-web.

## 1. Capture the referral code → first-party cookie

On any page load where `?ref=CODE` is present:

- If **no** `hdpm_ref` cookie exists yet, set it (first-touch-wins — never
  overwrite an existing one):
  - `hdpm_ref` = the `CODE` value
  - `Max-Age` = `7776000` (90 days), `Path=/`, `SameSite=Lax`, `Secure`
- Also capture marketing context into `hdpm_attr` (JSON, same cookie options),
  again first-touch-only: `{ utm_source, utm_medium, utm_campaign, utm_term,
  utm_content, landing_page }` from the query string + `window.location.pathname`.

First-touch-wins matters: it's how HDPM-OS resolves attribution disputes. Do not
overwrite either cookie once set.

## 2. Post owner-inquiry submissions to HDPM-OS

When an **owner inquiry** form is submitted (the "get a rental analysis / talk to
us about managing my property" form — NOT tenant/renter inquiries), after (or
alongside) your existing lead handling, POST server-side to HDPM-OS:

```
POST https://hdpmchat.highdesertpm.com/api/intake/referral-lead
Authorization: Bearer <HDPM service token with 'referrals' scope>
Content-Type: application/json

{
  "prospect_name":  "<owner full name>",        // required
  "prospect_email": "<email>",                   // optional but strongly wanted
  "prospect_phone": "<phone>",                   // optional
  "property_addresses": ["<address>"],           // optional, array
  "unit_count": 4,                               // optional, number
  "notes": "<free text from the form>",          // optional
  "ref_code": "<hdpm_ref cookie value or null>", // drives referral vs organic
  "utm": { ...hdpm_attr utm fields... },         // optional
  "landing_page": "<hdpm_attr.landing_page>",    // optional
  "hdpm_web_lead_id": "<your Lead id>"           // optional, links the two SoRs
}
```

- **Send it server-side** (from your form handler / API route), not from the
  browser — the bearer token must never reach the client. Read the `hdpm_ref` /
  `hdpm_attr` cookies on the server from the request.
- `ref_code` present + valid → HDPM-OS records `source=referral` and credits the
  partner. Absent/unknown → `source=organic` (still captured, with UTM). Either
  way the lead enters the same pipeline — this is the single owner-acquisition
  funnel.
- Keep doing whatever you do today with the lead in hdpm-web; this POST is
  additive. `hdpm_web_lead_id` lets HDPM-OS link back to your `Lead` record
  (HDPM-OS is SoR for pipeline/attribution; hdpm-web `Lead` stays SoR for the
  website contact record).

## 3. Auth token

Mint a per-service token with the `referrals` scope (HDPM-OS `service_token`
table) and put it in hdpm-web's server env. The legacy `HDPM_SERVICE_TOKEN`
(scope `all`) also works if you already share one, but a scoped token is
preferred.

## 4. Response

`201 { "ok": true, "leadId": "<uuid>" }` on success; `401` if the token is
missing/invalid; `400` if `prospect_name` is absent. Treat non-2xx as a soft
failure (log + retry later) — don't block the user's form submission on it.

## Test

With the token set, a `curl` from anywhere:

```
curl -X POST https://hdpmchat.highdesertpm.com/api/intake/referral-lead \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"prospect_name":"Test Owner","prospect_email":"t@example.com","ref_code":null,"landing_page":"/manage"}'
```

should return `201` and the lead appears in `/partners/admin/leads` as an
`organic` submission. Repeat with a real `ref_code` and it shows as `referral`.
