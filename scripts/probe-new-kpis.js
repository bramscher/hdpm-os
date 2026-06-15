/** Smoke-test the new KPI logic against live AppFolio (mirrors the fetchers). */
require("dotenv").config({ path: ".env.local" });
const BASE = "https://api.appfolio.com/api/v0";
function headers() {
  const auth = Buffer.from(`${process.env.APPFOLIO_CLIENT_ID}:${process.env.APPFOLIO_CLIENT_SECRET}`).toString("base64");
  return { Authorization: `Basic ${auth}`, "X-AppFolio-Developer-ID": process.env.APPFOLIO_DEVELOPER_ID, Accept: "application/json" };
}
async function all(path, params = {}, maxPages = 60) {
  const out = []; let page = 1;
  while (page <= maxPages) {
    const url = new URL(`${BASE}${path}`);
    Object.entries({ ...params, "page[number]": page, "page[size]": 200 }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    const j = await res.json();
    out.push(...(j.data || []));
    if ((j.data || []).length < 200 || !j.next_page_path) break;
    page++; await new Promise((s) => setTimeout(s, 150));
  }
  return out;
}
async function main() {
  const units = await all("/units", { "filters[LastUpdatedAtFrom]": "2000-01-01T00:00:00Z" });
  const active = units.filter((u) => !u.HiddenAt);
  // Occupancy
  const vacant = active.filter((u) => /vacant|available/i.test(u.Status || "")).length;
  console.log(`OCCUPANCY: ${(100 * (active.length - vacant) / active.length).toFixed(1)}% (${active.length - vacant}/${active.length} occupied, ${vacant} vacant)`);
  // Bend mix + premium
  const rev = active.filter((u) => !u.NonRevenue);
  const isBend = (u) => (u.City || "").trim().toLowerCase() === "bend";
  const bend = rev.filter(isBend);
  const avg = (l) => { const r = l.map((u) => parseFloat(u.MarketRent || "0")).filter((x) => x > 0); return r.length ? Math.round(r.reduce((a, b) => a + b) / r.length) : 0; };
  const ba = avg(bend), na = avg(rev.filter((u) => !isBend(u)));
  console.log(`BEND MIX: ${(100 * bend.length / rev.length).toFixed(1)}% (${bend.length}/${rev.length}) | Bend $${ba} vs non-Bend $${na} → ${na ? ((100 * (ba - na) / na).toFixed(1)) : 0}% premium`);
  // City distribution (sanity)
  const cities = {}; rev.forEach((u) => { const c = (u.City || "?").trim(); cities[c] = (cities[c] || 0) + 1; });
  console.log("  cities:", Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}:${n}`).join(", "));

  // Lease expirations
  const leases = await all("/leases", { "filters[LastUpdatedAtFrom]": "2020-01-01T00:00:00Z" });
  const fe = leases.filter((l) => l.Status === "Fully Executed");
  const now = Date.now(); let w30 = 0, w60 = 0, w90 = 0, mtm = 0;
  for (const l of fe) {
    if (l.IsMtm || !l.EndOn) { mtm++; continue; }
    const d = (new Date(l.EndOn).getTime() - now) / 86400000;
    if (d < 0) continue;
    if (d <= 30) w30++; if (d <= 60) w60++; if (d <= 90) w90++;
  }
  console.log(`LEASE EXPIRATIONS: ${w30}/30d ${w60}/60d ${w90}/90d | ${mtm} MTM | ${fe.length} active leases`);

  // Work orders completed MoM
  const wos = await all("/work_orders", { "filters[LastUpdatedAtFrom]": new Date(now - 120 * 86400000).toISOString() });
  const tmStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const lmStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
  let tm = 0, lm = 0;
  for (const w of wos) { if (!w.CompletedOn) continue; const c = new Date(w.CompletedOn); if (c >= tmStart) tm++; else if (c >= lmStart) lm++; }
  console.log(`WO COMPLETED: ${tm} this month, ${lm} last month (Δ${tm - lm})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
