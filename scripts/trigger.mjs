/**
 * The scheduled job, as an HTTP call.
 *
 * The collector used to run here, which meant this job needed its own
 * DATABASE_URL — and a job pointed at the wrong database is a failure mode with
 * no good error message. There is no reason for two places to know how to reach
 * the database when one of them already does.
 *
 * So this asks the app to collect. The app owns the database connection, the
 * API keys and the schema. This job knows two things: where the app is, and the
 * shared secret. Neither can be pointed at the wrong database.
 *
 * Plain Node, no dependencies, no build step.
 */

const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const secret = process.env.COLLECT_SECRET ?? "";
const days = process.env.COLLECT_DAYS ?? "3";
const classifyCap = process.env.CLASSIFY_CAP ?? "25";
const classify = process.env.CLASSIFY_AFTER_COLLECT === "1";

if (!base) fail("APP_URL is not set. Set it to the dashboard's address, e.g. https://your-app.vercel.app");
if (!secret) fail("COLLECT_SECRET is not set. Use the same value as the Vercel project.");

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function call(path, label) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "x-collect-secret": secret },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) fail(`${label}: the app rejected the secret. COLLECT_SECRET must match the Vercel project.`);
    if (res.status === 404) fail(`${label}: no such endpoint at ${base}. Check APP_URL points at the dashboard.`);
    fail(`${label}: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

const started = Date.now();
console.log(`app: ${base}`);

const c = await call(`/api/collect?days=${days}`, "collect");

/** One line per source. A source that failed says so and does not hide the others. */
function report(label, r) {
  if (!r) return;
  if (r.error) { console.log(`${label}: FAILED — ${r.error}`); failures++; return; }
  console.log(
    `${label} (${days}d): checked ${r.checked}, created ${r.created}, ` +
    `changed ${r.changed}, unchanged ${r.skipped ?? 0}` +
    (r.archived ? `, archived ${r.archived}` : "") +
    (r.note ? ` — ${r.note}` : "")
  );
}
let failures = 0;
report("Federal Register", c.federalRegister ?? c);
report("Congress", c.congress);
report("Regulations.gov", c.regulations);

if (classify) {
  const k = await call(`/api/admin/classify?limit=${classifyCap}`, "classify");
  console.log(`Classifier: checked ${k.checked}, filed ${k.filed}, ghosted ${k.ghosted}, left ${k.leftAlone}`);
} else {
  console.log("Classifier: off (set CLASSIFY_AFTER_COLLECT=1 to file new arrivals automatically)");
}

console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
// A source that failed should turn the run red, so it shows in Render.
if (failures) process.exit(1);
