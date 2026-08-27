// Week 0 verification (restart plan §7). Read-only.
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function tableProbe(name, opts = {}) {
  const { data, error, count } = await supabase
    .from(name)
    .select(opts.select || "*", { count: "exact", head: !opts.select })
    .limit(opts.limit || 0);
  if (error) return { name, ok: false, error: error.message };
  return { name, ok: true, count, sample: data };
}

async function main() {
  // ── Check 1: did the agent_config migration run? ──
  console.log("\n=== CHECK 1: agent_config ===");
  const cfg = await supabase
    .from("agent_config")
    .select("agent, action_type, autonomy_level, enabled")
    .order("agent");
  if (cfg.error) {
    console.log("  ❌ agent_config:", cfg.error.message);
  } else {
    console.log(`  rows: ${cfg.data.length}`);
    for (const r of cfg.data) {
      console.log(
        `    ${r.agent} / ${r.action_type} → L${r.autonomy_level} ${r.enabled ? "ENABLED" : "disabled"}`
      );
    }
  }

  // ── Check 2: metrics_snapshot baseline frozen? ──
  console.log("\n=== CHECK 2: metrics_snapshot (baseline) ===");
  const ms = await supabase
    .from("metrics_snapshot")
    .select("*", { count: "exact" })
    .order("captured_at", { ascending: false })
    .limit(3);
  if (ms.error) {
    console.log("  ❌ metrics_snapshot:", ms.error.message);
  } else {
    console.log(`  total rows: ${ms.count}`);
    for (const r of ms.data) {
      const when = r.created_at || r.snapshot_date || r.captured_at || "?";
      console.log(`    latest: ${when}  keys=[${Object.keys(r).slice(0, 8).join(", ")}]`);
    }
  }

  // ── Check 1b: motion-metric tables exist? ──
  console.log("\n=== CHECK 1b: motion tables ===");
  for (const t of ["agent_proposal", "agent_outbox", "wo_event"]) {
    const p = await tableProbe(t);
    console.log(p.ok ? `  ✓ ${t}: ${p.count} rows` : `  ❌ ${t}: ${p.error}`);
  }

  // ── The one number: agent-originated human-completed actions ──
  console.log("\n=== MOTION metric (restart §8) ===");
  const prop = await supabase
    .from("agent_proposal")
    .select("status", { count: "exact", head: false })
    .in("status", ["approved", "edited"]);
  if (prop.error) console.log("  ❌", prop.error.message);
  else console.log(`  agent_proposal approved/edited: ${prop.count ?? prop.data.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
