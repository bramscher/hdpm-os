/** Identify the internal/in-house maintenance vendor(s) and confirm in-house
 * spend flows through /bills on maintenance GL accounts. Read-only. */
require("dotenv").config({ path: ".env.local" });
const BASE = "https://api.appfolio.com/api/v0";
function headers() {
  const auth = Buffer.from(`${process.env.APPFOLIO_CLIENT_ID}:${process.env.APPFOLIO_CLIENT_SECRET}`).toString("base64");
  return { Authorization: `Basic ${auth}`, "X-AppFolio-Developer-ID": process.env.APPFOLIO_DEVELOPER_ID, Accept: "application/json" };
}
async function all(path, params = {}, maxPages = 60) {
  const out = [];
  let page = 1;
  while (page <= maxPages) {
    const url = new URL(`${BASE}${path}`);
    Object.entries({ ...params, "page[number]": page, "page[size]": 200 }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 150)}`);
    const j = await res.json();
    out.push(...(j.data || []));
    if ((j.data || []).length < 200 || !j.next_page_path) break;
    page++;
    await new Promise((s) => setTimeout(s, 150));
  }
  return out;
}
async function main() {
  const vendors = await all("/vendors", { "filters[LastUpdatedAtFrom]": "1970-01-01T00:00:00Z" });
  console.log(`Total vendors: ${vendors.length}`);
  const internal = vendors.filter((v) => {
    const blob = `${v.CompanyName || ""} ${v.FirstName || ""} ${v.LastName || ""} ${v.Address1 || ""}`.toLowerCase();
    return /high desert|hdpm|hdms|in.?house/.test(blob);
  });
  console.log(`\nInternal-looking vendors (${internal.length}):`);
  internal.forEach((v) => console.log(`  ${v.Id}  | ${v.CompanyName || `${v.FirstName} ${v.LastName}`} | ${v.Address1 || ""}`));
  const internalIds = new Set(internal.map((v) => v.Id));

  // TTM bills on maintenance GL (6xxx), split by internal vs external vendor
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
  const [bills, gl] = await Promise.all([
    all("/bills", { "filters[LastUpdatedAtFrom]": yearAgo }),
    all("/gl_accounts", {}),
  ]);
  const maintGl = new Set(gl.filter((a) => a.AccountType === "ExpenseGlAccount" && (a.Number || "").startsWith("6")).map((a) => a.Id));
  const glName = new Map(gl.map((a) => [a.Id, `${a.Number} ${a.Name || a.AccountName}`]));
  console.log(`\nBills (TTM by LastUpdatedAt): ${bills.length}`);

  let inHouse = 0, outsourced = 0, mgmtPayee = 0;
  const byCat = new Map();
  for (const b of bills) {
    let billMaint = 0;
    for (const li of b.LineItems || []) {
      if (li.GlAccountId && maintGl.has(li.GlAccountId)) {
        const amt = parseFloat(li.Amount || "0");
        billMaint += amt;
        const k = glName.get(li.GlAccountId);
        byCat.set(k, (byCat.get(k) || 0) + amt);
      }
    }
    if (billMaint === 0) continue;
    if (b.ManagementCompanyAsPayee) mgmtPayee += billMaint;
    if (internalIds.has(b.VendorId)) inHouse += billMaint;
    else outsourced += billMaint;
  }
  const total = inHouse + outsourced;
  console.log(`\nMaintenance (6xxx) TTM spend: $${total.toFixed(0)}`);
  console.log(`  in-house (internal vendor):  $${inHouse.toFixed(0)} (${total ? (100 * inHouse / total).toFixed(1) : 0}%)`);
  console.log(`  outsourced:                  $${outsourced.toFixed(0)}`);
  console.log(`  (ManagementCompanyAsPayee maint $: $${mgmtPayee.toFixed(0)})`);
  console.log(`\nBy category:`);
  [...byCat.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  $${v.toFixed(0).padStart(10)}  ${k}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
