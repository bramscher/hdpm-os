# Starter Data Model (Supabase)

Draft to pressure-test against the existing hdpm-chat schema — reuse existing tables (users, properties, time/materials, invoices) wherever they exist. Naming below is illustrative, not gospel.

```sql
-- Work-order mirror (AppFolio remains system of record)
create table wo (
  id uuid primary key default gen_random_uuid(),
  appfolio_wo_id text unique,               -- link to system of record
  property_unit text not null,
  category text not null,
  description text,
  origin text not null,                     -- haven | inspection | turn | owner | staff | preventive
  priority text check (priority in ('P1','P2','P3','P4')),
  status text not null default 'NEW' check (status in
    ('NEW','TRIAGED','SCHEDULED','IN_PROGRESS','WAITING_ON','VERIFY','BILL','CLOSED')),
  waiting_reason text check (waiting_reason in
    ('TENANT','VENDOR','PARTS','OWNER','WEATHER','INTERNAL')),
  owner_name text,                          -- ONE accountable person
  next_action_date date,
  vendor_id uuid references vendor(id),     -- null = HDMS internal
  assigned_tech text,                       -- alberto | brody | null
  is_turn boolean default false,
  verified_by text, verified_at timestamptz,
  created_at timestamptz default now(),
  closed_at timestamptz,
  -- invariants (tripwires catch soft violations; these catch hard ones)
  constraint waiting_needs_reason check (status != 'WAITING_ON' or waiting_reason is not null),
  constraint open_needs_owner check (status = 'CLOSED' or owner_name is not null)
);

-- Append-only audit trail: every change is an event, nothing overwritten silently
create table wo_event (
  id bigint generated always as identity primary key,
  wo_id uuid not null references wo(id),
  event_type text not null,   -- status_change | assign | schedule | note | photo | scope_change
                              -- | approval_request | approval_decision | failed_access
                              -- | recommendation | tenant_ping | tenant_reply | invoice | exception
  payload jsonb not null default '{}',
  actor text not null,        -- user or 'system:tripwire-4'
  created_at timestamptz default now()
);

-- Vendor profiles (the Lula replacement)
create table vendor (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trades text[] not null,
  service_area text,
  license_number text, license_expiry date, license_required_trades text[],
  insurance_carrier text, insurance_expiry date,
  w9_on_file boolean default false,
  hourly_rate numeric, minimum_charge numeric,
  emergency_available boolean default false,
  preferred boolean default false,
  property_restrictions text[],             -- property ids/names this vendor may NOT serve
  active boolean default true,
  notes text
);

-- Rolling performance → ranking (materialized view or nightly job)
create table vendor_assignment (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid not null references wo(id),
  vendor_id uuid not null references vendor(id),
  sent_at timestamptz default now(),
  accepted_at timestamptz, declined_at timestamptz,
  scheduled_at timestamptz, completed_at timestamptz,
  callback boolean default false            -- rework on same issue
);

-- Approvals (owner or PM)
create table approval (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid not null references wo(id),
  kind text not null check (kind in ('OWNER','PM')),
  requested_of text not null,
  estimate numeric, photos jsonb,
  requested_at timestamptz default now(),
  decided_at timestamptz, decision text check (decision in ('APPROVED','DECLINED')),
  approved_amount numeric, conditions text
);

-- Field recommendations (tripwire #10)
create table recommendation (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid references wo(id),
  tech text not null, body text not null,
  created_at timestamptz default now(),
  resolved_wo_id uuid references wo(id),    -- became a WO, or…
  dismissed_reason text                     -- …dismissed in writing
);

-- Turns (feeds Turnover board)
create table turn (
  wo_id uuid primary key references wo(id),
  vacated_at date not null,
  target_ready date,
  current_blocker text,
  budget numeric, actual numeric
);
```

Notes:
- **Exceptions view = query, not table**: union of the 12 tripwire conditions, each row tagged with tripwire #, owner, fix-by. Cron writes `exception` events for history; the view is always live.
- **RLS**: vendors → only their `vendor_assignment` rows + scoped WO fields; techs → their assigned WOs; office roles → all; no tenant access (Haven is the tenant interface).
- **Money**: reuse the existing invoice/pricing module. This schema never stores owner ledgers — single-line bill upload to AppFolio stays as-is.
- **Ranking score** (seed formula, tune later): `0.3*accept_speed + 0.25*completion_speed + 0.25*(1-callback_rate) + 0.2*docs_compliance`, per trade, rolling 90 days; manual demote flag overrides (Monday review).
