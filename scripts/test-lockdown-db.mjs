// 20261031_lock_down_work_orders.sql against the tables as the old setup scripts made them, with
// Supabase's roles and default grants: the browser roles get in before, and only the server after.
// Run: node scripts/test-lockdown-db.mjs
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = await PGlite.create();
let count = 0;
const ok = (v, m) => { assert.ok(v, m); count++; };
const denied = async (sql, m) => { await assert.rejects(() => db.query(sql), /permission denied/, m); count++; };
const file = path => readFile(new URL(path, import.meta.url), 'utf8');
const one = async sql => (await db.query(sql)).rows[0];
const TABLES = ['work_orders', 'hdms_invoices', 'rental_comps', 'market_baselines'];

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE reporting;');
  await db.exec(await file('./create-hdms-invoices.sql'));
  await db.exec(await file('./create-work-orders.sql'));
  await db.exec(await file('./create-rental-comps.sql'));
  // Supabase's default grants, a policy someone could have added in the dashboard, and one for another role.
  await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, reporting;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    CREATE POLICY "Public read" ON work_orders FOR SELECT TO anon USING (true);
    CREATE POLICY "Reporting read" ON hdms_invoices FOR SELECT TO reporting USING (true);`);
  await db.exec(`INSERT INTO work_orders(appfolio_id, property_name, description) VALUES ('af-1', 'Weinberger 284', 'Remove TV mount')`);

  // Before: the open policy lets the browser roles read and change work orders.
  await db.exec('SET ROLE anon');
  ok((await one('SELECT count(*)::int n FROM work_orders')).n === 1, 'Before: anon reads work orders');
  await db.query(`UPDATE work_orders SET description = 'changed by anon'`);
  await db.exec('RESET ROLE');
  ok((await one('SELECT description FROM work_orders')).description === 'changed by anon', 'Before: anon changes work orders');

  const migration = await file('../supabase/migrations/20261031_lock_down_work_orders.sql');
  await db.exec(migration);
  await db.exec(migration);
  ok(true, 'Runs twice');

  // After: no browser role reads or writes any of the four tables, or takes an invoice number.
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const t of TABLES) {
      await denied(`SELECT * FROM ${t}`, `${role} can't read ${t}`);
      await denied(`DELETE FROM ${t}`, `${role} can't delete from ${t}`);
    }
    await denied(`UPDATE work_orders SET description = 'x'`, `${role} can't change work orders`);
    await denied(`INSERT INTO work_orders(appfolio_id, property_name, description) VALUES ('af-2', 'P', 'x')`, `${role} can't add work orders`);
    await denied(`SELECT nextval('hdms_invoice_number_seq')`, `${role} can't take an invoice number`);
    await db.exec('RESET ROLE');
  }

  // The server key keeps working, invoice numbers included.
  await db.exec('SET ROLE service_role');
  await db.query(`UPDATE work_orders SET description = 'Remove TV mount'`);
  await db.query(`INSERT INTO work_orders(appfolio_id, property_name, description) VALUES ('af-2', 'Cedar Creek', 'Paint touch up')`);
  ok((await one('SELECT count(*)::int n FROM work_orders')).n === 2, 'Service role reads and writes work orders');
  const inv = await one(`INSERT INTO hdms_invoices(property_name, property_address, description, created_by) VALUES ('Weinberger 284', '3602 SW Badger Ave', 'Repair', 'test') RETURNING invoice_code`);
  ok(/^HDMS-INV-\d{6}$/.test(inv.invoice_code), 'Service role still numbers invoices');
  for (const t of ['rental_comps', 'market_baselines']) ok((await one(`SELECT count(*)::int n FROM ${t}`)).n >= 0, `Service role reads ${t}`);
  await db.exec('RESET ROLE');

  // Each table keeps one policy, for the service role; the other role's policy is untouched.
  const pols = (await db.query(`SELECT tablename, policyname, array_to_string(roles, ',') AS roles FROM pg_policies WHERE tablename = ANY($1) ORDER BY 1, 2`, [TABLES])).rows;
  const byTable = Object.fromEntries(TABLES.map(t => [t, pols.filter(p => p.tablename === t)]));
  for (const t of TABLES) ok(byTable[t].some(p => p.roles === 'service_role') && byTable[t].every(p => !/public|anon|authenticated/.test(p.roles)), `${t}: only the service role and other non-browser roles have policies`);
  ok(byTable.hdms_invoices.some(p => p.policyname === 'Reporting read'), 'A policy for another role is left alone');
  ok(!pols.some(p => p.policyname === 'Public read'), 'The dashboard-style public policy is gone');
  ok((await one(`SELECT bool_and(relrowsecurity) AS rls FROM pg_class WHERE relname = ANY('{work_orders,hdms_invoices,rental_comps,market_baselines}')`)).rls, 'RLS is on for all four');

  console.log(`lockdown db: ${count} checks passed`);
} finally {
  await db.close();
}
