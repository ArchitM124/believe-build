/**
 * Framework-free core of the possession analysis.
 *
 * It runs a deliberate TWO-PASS pipeline to fight confident-but-wrong output:
 *
 *   Pass 1 (OBSERVE): the model watches the clip and reports ONLY what is
 *     literally visible, moment by moment, with timestamps and an explicit
 *     "certain" flag. It is forbidden from coaching or inferring intent.
 *
 *   Pass 2 (JUDGE): the model does NOT see the video. It writes the coaching
 *     breakdown grounded STRICTLY in Pass 1's observation log, must cite the
 *     timestamps it relies on, and must lower its confidence when the log is
 *     thin or uncertain.
 *
 * Separating "what I saw" from "what I think" is the biggest lever against
 * hallucinated specificity. Low temperature keeps both passes literal.
 *
 * This module has no TanStack/Supabase imports on purpose: the server function
 * uses it in production, and eval/run-eval.ts uses it offline to measure
 * accuracy against known-truth clips.
 */

export type AttackDirection = "left" | "right" | "unclear";

export type AnalysisContext = {
  role: string; // "coach" | "player"
  title?: string | null;
  notes?: string | null;
  teamColor?: string | null; // uploader's team jersey color, e.g. "white"
  attackDirection?: AttackDirection | string | null;
  durationSec?: number | null;
};

export type Observation = { t: string; desc: string; certain: boolean };

export type Outcome =
  | "made_shot"
  | "missed_shot"
  | "turnover"
  | "defensive_stop"
  | "defensive_breakdown"
  | "foul"
  | "other";

export type Confidence = "low" | "medium" | "high";

export type AnalysisResult = {
  outcome: Outcome;
  what_happened: string;
  what_went_right: string;
  what_went_wrong: string;
  alternative: string;
  confidence: Confidence;
  flagged: boolean;
  readable: boolean;
  observations: Observation[];
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";

const OUTCOMES = new Set<Outcome>([
  "made_shot",
  "missed_shot",
  "turnover",
  "defensive_stop",
  "defensive_breakdown",
  "foul",
  "other",
]);
const CONFIDENCES = new Set<Confidence>(["low", "medium", "high"]);

type GatewayMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "file"; file: { filename: string; file_data: string } }
      >;
};

async function callGateway(
  apiKey: string,
  messages: GatewayMessage[],
  temperature: number,
): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      messages,
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("Rate limit reached — try again in a minute");
  if (res.status === 402) throw new Error("AI credits exhausted — top up Lovable AI to continue");
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI gateway error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json?.choices?.[0]?.message?.content ?? "{}";
}

function parseJson<T>(content: string): T {
  // Strip accidental markdown fences the model sometimes adds anyway.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  return JSON.parse(cleaned) as T;
}

function contextBlock(ctx: AnalysisContext): string {
  const dir =
    ctx.attackDirection && ctx.attackDirection !== "unclear"
      ? `attacking the ${ctx.attackDirection}-side basket`
      : "attacking direction unknown";
  const team = ctx.teamColor?.trim()
    ? `The uploader's team wears ${ctx.teamColor.trim()} and is ${dir}.`
    : `The uploader did not specify their team's jersey color.`;
  return [
    `Uploader role: ${ctx.role}`,
    team,
    `Uploader title: ${ctx.title?.trim() || "(none)"}`,
    `Uploader notes: ${ctx.notes?.trim() || "(none)"}`,
    `Clip duration: ~${ctx.durationSec ?? "unknown"}s`,
  ].join("\n");
}

// ---- Pass 1: observation only -------------------------------------------

type ObservationResponse = {
  readable?: boolean;
  team_in_possession_color?: string;
  observations?: Array<{ t?: unknown; desc?: unknown; certain?: unknown }>;
};

const OBSERVE_SYSTEM = `You are a meticulous basketball video observer. You are watching ONE possession clip. Your ONLY job is to report what is LITERALLY visible, moment by moment. You do NOT coach, judge, or infer intent.

Hard rules:
- Report events in time order, each with an approximate timestamp (e.g. "0:03").
- Identify players ONLY by jersey color and court location (e.g. "white ball-handler at the right wing"). NEVER invent names or numbers.
- Set "certain": false whenever the moment is blurry, occluded, off-frame, or too fast to be sure. Do not guess to fill gaps.
- Only report the possession's final result if you actually see it happen on screen.
- If the clip is too low-quality, too short, or not clearly basketball, set "readable": false.`;

function observeUser(ctx: AnalysisContext, videoDataUrl: string): GatewayMessage {
  const text = `Observe this single basketball possession. Report only what you can see.

${contextBlock(ctx)}

Return ONLY valid JSON — no prose, no markdown fences:
{
  "readable": boolean,                  // false if too blurry/short/unclear to analyze reliably
  "team_in_possession_color": string,   // jersey color of the team on offense, or "unclear"
  "observations": [
    { "t": string, "desc": string, "certain": boolean }
  ]
}`;
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "file", file: { filename: "possession.mp4", file_data: videoDataUrl } },
    ],
  };
}

// ---- Pass 2: coaching analysis grounded in Pass 1 -----------------------

type JudgeResponse = {
  outcome?: string;
  what_happened?: string;
  what_went_right?: string;
  what_went_wrong?: string;
  alternative?: string;
  confidence?: string;
  flagged?: boolean;
};

const JUDGE_SYSTEM = `You are PlayIQ, an elite basketball film-study analyst. You are given a VERIFIED observation log from a single possession. You did NOT watch the video yourself — build your entire analysis STRICTLY from the log.

Hard rules:
- Do NOT introduce any detail that is not supported by an observation. If the log does not establish something, treat it as unknown and say so.
- Prefer observations with "certain": true. Treat "certain": false as tentative and let it lower your confidence.
- In each field, cite the timestamp(s) you rely on, e.g. "(~0:04)".
- If the log is thin, mostly uncertain, or "readable" was false, set confidence "low", keep claims minimal, and state plainly what could not be determined. Never invent specifics to sound authoritative.
- Use jersey COLORS, never invented names or numbers. Keep every field to 1–3 tight sentences.`;

function judgeUser(
  ctx: AnalysisContext,
  observation: ObservationResponse,
): GatewayMessage {
  const text = `Here is the verified observation log for one possession.

${contextBlock(ctx)}

Observation log (JSON):
${JSON.stringify(
  {
    readable: observation.readable ?? true,
    team_in_possession_color: observation.team_in_possession_color ?? "unclear",
    observations: observation.observations ?? [],
  },
  null,
  2,
)}

Return ONLY valid JSON matching this exact type — no prose, no markdown fences:
{
  "outcome": "made_shot"|"missed_shot"|"turnover"|"defensive_stop"|"defensive_breakdown"|"foul"|"other",
  "what_happened": string,     // Play-by-play grounded in the log, with cited timestamps.
  "what_went_right": string,   // Correct reads/decisions supported by the log. "" if none notable or unclear.
  "what_went_wrong": string,   // The breakdown: WHO (by color), WHERE, WHAT, and WHY — only if the log supports it. "" if unclear.
  "alternative": string,       // The specific better read, only if the log supports naming one. "" if unclear.
  "confidence": "low"|"medium"|"high",  // "high" ONLY if the log is dense and mostly certain.
  "flagged": boolean           // true if this is a strong, clear teaching moment.
}`;
  return { role: "user", content: [{ type: "text", text }] };
}

// ---- Public entry point -------------------------------------------------

export async function runPossessionAnalysis(params: {
  videoDataUrl: string;
  apiKey: string;
  context: AnalysisContext;
}): Promise<AnalysisResult> {
  const { videoDataUrl, apiKey, context } = params;

  // Pass 1 — watch and observe (low temperature: stay literal).
  const obsRaw = await callGateway(
    apiKey,
    [
      { role: "system", content: OBSERVE_SYSTEM },
      observeUser(context, videoDataUrl),
    ],
    0.15,
  );
  const obs = parseJson<ObservationResponse>(obsRaw);
  const observations: Observation[] = Array.isArray(obs.observations)
    ? obs.observations.map((o) => ({
        t: String(o?.t ?? ""),
        desc: String(o?.desc ?? ""),
        certain: Boolean(o?.certain),
      }))
    : [];

  // Pass 2 — coach the play from the log only (no video, slightly warmer).
  const judgeRaw = await callGateway(
    apiKey,
    [
      { role: "system", content: JUDGE_SYSTEM },
      judgeUser(context, obs),
    ],
    0.2,
  );
  const judged = parseJson<JudgeResponse>(judgeRaw);

  const rawOutcome = String(judged.outcome ?? "other") as Outcome;
  const rawConf = String(judged.confidence ?? "low") as Confidence;

  return {
    outcome: OUTCOMES.has(rawOutcome) ? rawOutcome : "other",
    confidence: CONFIDENCES.has(rawConf) ? rawConf : "low",
    what_happened: String(judged.what_happened ?? "").slice(0, 2000),
    what_went_right: judged.what_went_right ? String(judged.what_went_right).slice(0, 2000) : "",
    what_went_wrong: judged.what_went_wrong ? String(judged.what_went_wrong).slice(0, 2000) : "",
    alternative: judged.alternative ? String(judged.alternative).slice(0, 2000) : "",
    flagged: Boolean(judged.flagged),
    readable: obs.readable !== false,
    observations,
  };
}
