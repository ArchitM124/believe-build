/**
 * Offline accuracy harness for the possession analysis.
 *
 * It runs the SAME two-pass pipeline the app uses (possession-analysis.core.ts)
 * against a folder of clips whose real outcome you already know, then reports
 * how often the AI got the outcome right and prints its description next to the
 * truth so you can grade the specifics by eye.
 *
 * Usage:
 *   1. Put clips in eval/clips/
 *   2. Copy eval/cases.example.json -> eval/cases.json and fill it in
 *   3. export LOVABLE_API_KEY=...           (same key the app uses)
 *   4. bun run eval/run-eval.ts             (or: npx tsx eval/run-eval.ts)
 *
 * Nothing here touches the database or your live app — it's a lab bench.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPossessionAnalysis } from "../src/lib/possession-analysis.core";

const here = dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
};

type Case = {
  id: string;
  video: string; // path relative to eval/
  role?: string;
  title?: string;
  notes?: string;
  team_color?: string;
  attack_direction?: string;
  duration_seconds?: number;
  truth?: string; // one sentence: what actually happened
  expected_outcome?: string; // one of the outcome enums, for scoring
};

async function main() {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("Set LOVABLE_API_KEY in your environment first (the same key the app uses).");
    process.exit(1);
  }

  const casesPath = resolve(here, process.argv[2] ?? "cases.json");
  if (!existsSync(casesPath)) {
    console.error(
      `No cases file at ${casesPath}.\nCopy eval/cases.example.json to eval/cases.json and fill it in.`,
    );
    process.exit(1);
  }
  const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Case[];

  const results: unknown[] = [];
  let correct = 0;
  let graded = 0;

  for (const c of cases) {
    const videoPath = resolve(here, c.video);
    if (!existsSync(videoPath)) {
      console.error(`  ⚠ ${c.id}: video not found at ${videoPath} — skipping`);
      continue;
    }
    const bytes = readFileSync(videoPath);
    const mime = MIME[extname(videoPath).toLowerCase()] ?? "video/mp4";
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

    process.stdout.write(`▶ ${c.id} … `);
    let r;
    try {
      r = await runPossessionAnalysis({
        videoDataUrl: dataUrl,
        apiKey,
        context: {
          role: c.role ?? "coach",
          title: c.title ?? null,
          notes: c.notes ?? null,
          teamColor: c.team_color ?? null,
          attackDirection: c.attack_direction ?? null,
          durationSec: c.duration_seconds ?? null,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`ERROR: ${msg}`);
      results.push({ id: c.id, error: msg });
      continue;
    }

    const match = c.expected_outcome ? r.outcome === c.expected_outcome : null;
    if (match !== null) {
      graded++;
      if (match) correct++;
    }
    console.log(
      match === null
        ? `outcome=${r.outcome}`
        : match
          ? `✅ ${r.outcome}`
          : `❌ got ${r.outcome}, expected ${c.expected_outcome}`,
    );
    if (c.truth) console.log(`   truth: ${c.truth}`);
    console.log(`   said : ${r.what_happened}`);
    console.log(
      `   conf : ${r.confidence}  readable=${r.readable}  observations=${r.observations.length}`,
    );

    results.push({
      id: c.id,
      expected_outcome: c.expected_outcome ?? null,
      outcome: r.outcome,
      outcome_match: match,
      confidence: r.confidence,
      readable: r.readable,
      truth: c.truth ?? null,
      what_happened: r.what_happened,
      what_went_right: r.what_went_right,
      what_went_wrong: r.what_went_wrong,
      alternative: r.alternative,
      observations: r.observations,
    });
  }

  const outPath = resolve(here, "results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(
    `\n— Outcome accuracy: ${graded ? `${correct}/${graded} (${Math.round((100 * correct) / graded)}%)` : "no graded cases"} —`,
  );
  console.log(
    `Full results written to ${outPath}. Compare the "said" vs "truth" lines to grade the specifics by hand.`,
  );
}

main();
