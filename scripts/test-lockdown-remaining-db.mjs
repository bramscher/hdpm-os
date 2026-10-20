// 20261036_lock_down_remaining_tables.sql against tables left open the way the scan found them (no RLS,
// Supabase's default grants, one open policy): the browser roles get in before, and only the server after.
// Run: node scripts/test-lockdown-remaining-db.mjs
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = await PGlite.create();
let count = 0;
const ok = (v, m) => { assert.ok(v, m); count++; };
const denied = async (sql, m) => { await assert.rejects(() => db.query(sql), /permission denied/, m); count++; };
const one = async sql => (await db.query(sql)).rows[0];
// Two of the 17 are left out to check that a missing table is skipped.
const TABLES = ['cached_vacancies', 'dashboard_config', 'haven_conversation', 'import_batches', 'inspection_audit_log',
  'inspection_properties', 'inspections', 'kpi_snapshots', 'lead_events', 'property_mgmt_status', 'reception_call',
  'rent_analyses', 'route_plans', 'route_stops', 'zoom_contact_map'];

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE reporting;');
  for (const t of TABLES) await db.exec(`CREATE TABLE ${t} (id serial PRIMARY KEY, note text); INSERT INTO ${t}(note) VALUES ('private');`);
  await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, reporting;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    ALTER TABLE reception_call ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Allow all" ON reception_call FOR ALL USING (true) WITH CHECK (true);
    ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Reporting read" ON kpi_snapshots FOR SELECT TO reporting USING (true);`);

  // Before: the browser key reads and changes them.
  await db.exec('SET ROLE anon');
  ok((await one('SELECT count(*)::int n FROM reception_call')).n === 1, 'Before: anon reads reception_call through the open policy');
  await db.query(`UPDATE cached_vacancies SET note = 'changed by anon'`);
  ok((await one('SELECT note FROM cached_vacancies')).note === 'changed by anon', 'Before: anon changes a table with no RLS');
  await db.exec('RESET ROLE');

  const migration = await readFile(new URL('../supabase/migrations/20261036_lock_down_remaining_tables.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  ok(true, 'Runs twice, skipping the tables that do not exist');

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const t of TABLES) {
      await denied(`SELECT * FROM ${t}`, `${role} can't read ${t}`);
      await denied(`INSERT INTO ${t}(note) VALUES ('x')`, `${role} can't add to ${t}`);
    }
    await denied(`SELECT nextval('inspections_id_seq')`, `${role} can't take an id`);
    await db.exec('RESET ROLE');
  }

  await db.exec('SET ROLE service_role');
  for (const t of TABLES) {
    await db.query(`INSERT INTO ${t}(note) VALUES ('server')`);
    ok((await one(`SELECT count(*)::int n FROM ${t}`)).n === 2, `Service role reads and writes ${t}`);
  }
  await db.exec('RESET ROLE');

  const pols = (await db.query(`SELECT tablename, policyname, array_to_string(roles, ',') AS roles FROM pg_policies ORDER BY 1, 2`)).rows;
  for (const t of TABLES) {
    const mine = pols.filter(p => p.tablename === t);
    ok(mine.some(p => p.roles === 'service_role') && mine.every(p => !/public|anon|authenticated/.test(p.roles)), `${t}: only non-browser policies`);
  }
  ok(!pols.some(p => p.policyname === 'Allow all'), 'The open reception_call policy is gone');
  ok(pols.some(p => p.policyname === 'Reporting read'), 'A policy for another role is left alone');
  ok((await one(`SELECT bool_and(relrowsecurity) AS rls FROM pg_class WHERE relname = ANY('{${TABLES.join(',')}}')`)).rls, 'RLS is on for all');

  // The check in the migration header comes back empty.
  const check = await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') AND has_table_privilege('anon', c.oid, 'SELECT')
      AND (NOT c.relrowsecurity OR EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.roles && ARRAY['public','anon']::name[]))`);
  ok(check.rows.length === 0, 'The after-check returns no rows');

  console.log(`lockdown remaining db: ${count} checks passed`);
} finally {
  await db.close();
}
