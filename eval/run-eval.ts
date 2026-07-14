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
import {
  runPossessionAnalysis,
  type AnalysisContext,
  type Provider,
} from "../src/lib/possession-analysis.core";

const here = dirname(fileURLToPath(import.meta.url));

/** Load KEY=VALUE lines from eval/.env into process.env (no dependency). */
function loadLocalEnv() {
  const envPath = resolve(here, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

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
  tracked_player?: string; // e.g. "white #23" — personal-coaching mode
  declared_outcome?: string; // uploader-declared result — anchoring mode
  truth?: string; // one sentence: what actually happened
  expected_outcome?: string; // one of the outcome enums, for scoring
};

// The eval uses the EXACT production pipeline (possession-analysis.core.ts),
// including its dual-provider transport. GEMINI_MODEL / AI_MODEL override the
// per-provider default model (e.g. gemini-flash-lite-latest for free runs).
function modelOverride(): string | undefined {
  return process.env.GEMINI_MODEL || process.env.AI_MODEL || undefined;
}

async function main() {
  loadLocalEnv();
  const lovableKey = process.env.LOVABLE_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const provider: "lovable" | "gemini" | null = lovableKey
    ? "lovable"
    : geminiKey
      ? "gemini"
      : null;
  if (!provider) {
    console.error(
      "No API key found. Put ONE of these in eval/.env:\n" +
        "  LOVABLE_API_KEY=...   (your app's key — tests the exact production path)\n" +
        "  GEMINI_API_KEY=...    (free from https://aistudio.google.com/apikey)",
    );
    process.exit(1);
  }
  console.log(`Provider: ${provider}${modelOverride() ? ` (${modelOverride()})` : ""}\n`);

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
    const base64 = bytes.toString("base64");
    const context: AnalysisContext = {
      role: c.role ?? "coach",
      title: c.title ?? null,
      notes: c.notes ?? null,
      teamColor: c.team_color ?? null,
      attackDirection: c.attack_direction ?? null,
      durationSec: c.duration_seconds ?? null,
      trackedPlayer: c.tracked_player ?? null,
      declaredOutcome: c.declared_outcome ?? null,
    };

    process.stdout.write(`▶ ${c.id} … `);
    let r;
    try {
      r = await runPossessionAnalysis({
        videoDataUrl: `data:${mime};base64,${base64}`,
        apiKey: (provider === "lovable" ? lovableKey : geminiKey) as string,
        provider: provider as Provider,
        model: modelOverride(),
        context,
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
    if (c.tracked_player) {
      if (r.what_went_right) console.log(`   +you : ${r.what_went_right}`);
      if (r.what_went_wrong) console.log(`   -you : ${r.what_went_wrong}`);
      if (r.alternative) console.log(`   next : ${r.alternative}`);
    }
    console.log(
      `   conf : ${r.confidence}  readable=${r.readable}  observations=${r.observations.length}` +
        (c.tracked_player ? `  tracked="${c.tracked_player}" found=${r.tracked_player_found}` : ""),
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
      tracked_player: c.tracked_player ?? null,
      tracked_player_found: r.tracked_player_found,
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
