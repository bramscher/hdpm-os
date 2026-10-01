-- Parts orders (workstream B). Tracks supplier orders behind WAITING_ON/PARTS work
-- orders so the chase board can follow them up. Additive; no AppFolio fields touched.
BEGIN;
CREATE TABLE IF NOT EXISTS supplier (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
 name text NOT NULL, phone text, email text, account_number text, pro_desk_notes text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id, name)
);
CREATE TABLE IF NOT EXISTS parts_order (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
 work_order_id uuid NOT NULL REFERENCES work_orders(id), supplier_id uuid NOT NULL REFERENCES supplier(id),
 item text NOT NULL CHECK(length(trim(item))>0), order_number text, po_number text,
 ordered_at date NOT NULL, expected_at date CHECK(expected_at IS NULL OR expected_at>=ordered_at), delivered_at timestamptz,
 status text NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','shipped','delivered','installed','issue','cancelled')),
 tracking_url text, last_contact_at timestamptz, notes text NOT NULL DEFAULT '',
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_order_work_order_idx ON parts_order(work_order_id);
CREATE INDEX IF NOT EXISTS parts_order_open_idx ON parts_order(status) WHERE status IN ('ordered','shipped','delivered','issue');
CREATE TABLE IF NOT EXISTS parts_order_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id uuid NOT NULL REFERENCES parts_order(id),
 kind text NOT NULL CHECK(kind IN ('call','email','text','status','note')),
 minutes_spent integer CHECK(minutes_spent IS NULL OR minutes_spent BETWEEN 0 AND 480),
 actor text NOT NULL, note text NOT NULL DEFAULT '', at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_order_event_order_idx ON parts_order_event(order_id);

INSERT INTO supplier(name, pro_desk_notes) VALUES
 ('Lowe''s (Bend Pro desk)', 'Pro desk handles special-order appliances.'),
 ('Home Depot', ''),
 ('Ferguson', '')
ON CONFLICT (org_id, name) DO NOTHING;

ALTER TABLE supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_order_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to supplier" ON supplier;
CREATE POLICY "Service role full access to supplier" ON supplier FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access to parts_order" ON parts_order;
CREATE POLICY "Service role full access to parts_order" ON parts_order FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access to parts_order_event" ON parts_order_event;
CREATE POLICY "Service role full access to parts_order_event" ON parts_order_event FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON supplier, parts_order, parts_order_event FROM PUBLIC, anon, authenticated;
GRANT ALL ON supplier, parts_order, parts_order_event TO service_role;
GRANT USAGE, SELECT ON SEQUENCE parts_order_event_id_seq TO service_role;
COMMIT;

NOTIFY pgrst, 'reload schema';
