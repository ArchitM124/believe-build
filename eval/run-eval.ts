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
  normalizeAnalysis,
  parseModelJson,
  observeUserText,
  judgeUserText,
  OBSERVE_SYSTEM,
  JUDGE_SYSTEM,
  type AnalysisContext,
  type AnalysisResult,
  type ObservationResponse,
  type JudgeResponse,
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
  truth?: string; // one sentence: what actually happened
  expected_outcome?: string; // one of the outcome enums, for scoring
};

// Production uses gemini-2.5-pro. Override with GEMINI_MODEL (e.g.
// gemini-2.5-flash, which is on Google's free tier) for a no-cost run.
function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-pro";
}

/**
 * Gemini-direct fallback: runs the SAME two-pass prompts as production
 * (imported from the core) against Google's native API, so the eval works
 * with a free Google AI Studio key when the Lovable key isn't handy. Only the
 * HTTP transport differs; the model, prompts, and normalization are identical.
 */
async function callGeminiJson(
  apiKey: string,
  systemText: string,
  userText: string,
  inlineVideo: { mimeType: string; base64: string } | null,
  temperature: number,
): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: userText }];
  if (inlineVideo) {
    parts.push({ inline_data: { mime_type: inlineVideo.mimeType, data: inlineVideo.base64 } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let lastErr = "";
  // Retry transient errors (fresh-project API-enablement propagation, rate limits).
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    }
    const errText = await res.text().catch(() => "");
    lastErr = `Gemini error ${res.status}: ${errText.slice(0, 160)}`;
    if ([403, 429, 500, 503].includes(res.status) && attempt < 5) {
      await sleep(attempt * 8000); // 8s, 16s, 24s, 32s
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr);
}

async function runViaGemini(params: {
  base64: string;
  mimeType: string;
  apiKey: string;
  context: AnalysisContext;
}): Promise<AnalysisResult> {
  const { base64, mimeType, apiKey, context } = params;
  const obsRaw = await callGeminiJson(
    apiKey,
    OBSERVE_SYSTEM,
    observeUserText(context),
    { mimeType, base64 },
    0.15,
  );
  const obs = parseModelJson<ObservationResponse>(obsRaw);
  const judgeRaw = await callGeminiJson(
    apiKey,
    JUDGE_SYSTEM,
    judgeUserText(context, obs),
    null,
    0.2,
  );
  const judged = parseModelJson<JudgeResponse>(judgeRaw);
  return normalizeAnalysis(obs, judged);
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
  console.log(`Provider: ${provider}${provider === "gemini" ? ` (${geminiModel()})` : ""}\n`);

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
    };

    process.stdout.write(`▶ ${c.id} … `);
    let r;
    try {
      r =
        provider === "lovable"
          ? await runPossessionAnalysis({
              videoDataUrl: `data:${mime};base64,${base64}`,
              apiKey: lovableKey as string,
              context,
            })
          : await runViaGemini({
              base64,
              mimeType: mime,
              apiKey: geminiKey as string,
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
