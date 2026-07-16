/**
 * Side-by-side comparison of eval runs across providers.
 *
 * Run the bench once per provider (each writes eval/results.<provider>.json):
 *   AI_PROVIDER=gemini     bun run eval/run-eval.ts
 *   AI_PROVIDER=perceptron bun run eval/run-eval.ts
 *   AI_PROVIDER=qwen       bun run eval/run-eval.ts
 * then:
 *   bun run eval/compare.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type Row = {
  id: string;
  expected_outcome: string | null;
  outcome?: string;
  outcome_match?: boolean | null;
  confidence?: string;
  tracked_player_found?: boolean | null;
  error?: string;
};

const files = readdirSync(here).filter((f) => /^results\.[a-z]+\.json$/.test(f));
if (!files.length) {
  console.error("No eval/results.<provider>.json files found — run the bench first.");
  process.exit(1);
}

const runs = new Map<string, Map<string, Row>>();
for (const f of files) {
  const provider = f.replace(/^results\./, "").replace(/\.json$/, "");
  const rows = JSON.parse(readFileSync(resolve(here, f), "utf8")) as Row[];
  runs.set(provider, new Map(rows.map((r) => [r.id, r])));
}

const providers = [...runs.keys()];
const clipIds = [...new Set([...runs.values()].flatMap((m) => [...m.keys()]))].sort();

const cell = (r: Row | undefined): string => {
  if (!r) return "—";
  if (r.error) return "ERR";
  if (r.outcome_match === true) return `✅ ${r.outcome}`;
  if (r.outcome_match === false) return `❌ ${r.outcome}`;
  return r.outcome ?? "—";
};

const w = 24;
console.log(["clip".padEnd(10), ...providers.map((p) => p.padEnd(w))].join(""));
for (const id of clipIds) {
  console.log(
    [id.padEnd(10), ...providers.map((p) => cell(runs.get(p)?.get(id)).padEnd(w))].join(""),
  );
}
console.log("");
for (const p of providers) {
  const rows = [...(runs.get(p)?.values() ?? [])];
  const graded = rows.filter((r) => r.outcome_match !== null && !r.error);
  const correct = graded.filter((r) => r.outcome_match === true);
  const errors = rows.filter((r) => r.error).length;
  const found = rows.filter((r) => r.tracked_player_found === true).length;
  const tracked = rows.filter((r) => r.tracked_player_found !== null && !r.error).length;
  console.log(
    `${p}: ${correct.length}/${graded.length} outcomes` +
      `${tracked ? `, player found ${found}/${tracked}` : ""}` +
      `${errors ? `, ${errors} errors` : ""}`,
  );
}
const casesPath = resolve(here, "cases.json");
if (existsSync(casesPath)) {
  console.log(
    "\nGrade the words, not just the labels: compare each provider's 'what_happened' in its results file against the truth in cases.json.",
  );
}
