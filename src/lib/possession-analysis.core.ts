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
  /**
   * Free-text description of ONE player to track and coach personally.
   * Organized game: "white #23". Pickup: "gray hoodie, red shorts, starts in
   * the left corner". Null/empty = analyze the whole team.
   */
  trackedPlayer?: string | null;
  /**
   * Uploader-declared result (an Outcome enum value, e.g. "turnover"). Treated
   * as fact: the AI locates/explains that event instead of guessing the
   * outcome, and everything after it is dead ball. Null = AI classifies.
   */
  declaredOutcome?: string | null;
};

const OUTCOME_PHRASE: Record<string, string> = {
  made_shot: "a made shot",
  missed_shot: "a missed shot",
  turnover: "a turnover",
  foul: "a foul",
  defensive_stop: "a defensive stop",
  defensive_breakdown: "a defensive breakdown",
  other: "an unclear result",
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
  /** true/false when a tracked player was requested; null when not requested. */
  tracked_player_found: boolean | null;
  /** Countable events for the tracked player; null when not tracking. */
  player_stats: PlayerStats | null;
};

/**
 * Which AI transport to use:
 *  - "lovable": Lovable AI gateway (their key/credits) — the default.
 *  - "gemini": Google's API directly with your GEMINI_API_KEY.
 *  - "perceptron": Perceptron Mk1 (video-native, samples up to 2 FPS) with
 *    your PERCEPTRON_API_KEY.
 *  - "qwen": Alibaba Qwen3-VL via the DashScope OpenAI-compatible API with
 *    your QWEN_API_KEY (or DASHSCOPE_API_KEY).
 * Set AI_PROVIDER in the server env to force one; otherwise the first
 * configured key wins in the order gemini → perceptron → qwen → lovable.
 */
export type Provider = "lovable" | "gemini" | "perceptron" | "qwen" | "openrouter";

const DEFAULT_MODEL: Record<Provider, string> = {
  lovable: "google/gemini-2.5-pro",
  // Stable alias — always the current production Pro model (2.5-pro is
  // retired for new API keys; the alias sidesteps model-name churn).
  gemini: "gemini-pro-latest",
  perceptron: "perceptron-mk1",
  qwen: "qwen3-vl-plus",
  // OpenRouter is a gateway; default to Perceptron Mk1 but any slug works.
  openrouter: "perceptron/perceptron-mk1",
};

/** Per-provider config for the OpenAI-compatible transports. */
const OPENAI_COMPAT: Record<
  Exclude<Provider, "gemini">,
  { url: string; videoStyle: "file" | "video_url"; jsonMode: boolean }
> = {
  lovable: {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    videoStyle: "file",
    jsonMode: true,
  },
  perceptron: {
    url: "https://api.perceptron.inc/v1/chat/completions",
    videoStyle: "video_url",
    // JSON mode undocumented — rely on the prompt + fence-stripping parser.
    jsonMode: false,
  },
  qwen: {
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    videoStyle: "video_url",
    jsonMode: false,
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    videoStyle: "video_url",
    jsonMode: false,
  },
};

type VideoPart = {
  dataUrl: string;
  mimeType: string;
  base64: string;
  /**
   * Optional short-lived remote URL for the same video (e.g. a Supabase
   * signed URL). video_url-style providers prefer this over inline base64 —
   * smaller requests, no inline size ceiling.
   */
  remoteUrl?: string;
};

function parseDataUrl(videoDataUrl: string, remoteUrl?: string): VideoPart {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(videoDataUrl);
  if (!m) throw new Error("Invalid video data URL");
  return { dataUrl: videoDataUrl, mimeType: m[1], base64: m[2], remoteUrl };
}

/**
 * Pick provider + key + model from environment variables (pure — pass in the
 * env object). AI_PROVIDER forces a provider (error if its key is missing);
 * otherwise: gemini → perceptron → qwen → lovable, first configured key wins.
 */
function keysFromEnv(
  env: Record<string, string | undefined>,
): Record<Provider, string | undefined> {
  return {
    gemini: env.GEMINI_API_KEY,
    perceptron: env.PERCEPTRON_API_KEY,
    qwen: env.QWEN_API_KEY || env.DASHSCOPE_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    lovable: env.LOVABLE_API_KEY,
  };
}

/** Config for one specific provider from env (throws if its key is missing). */
export function resolveProviderConfig(
  provider: Provider,
  env: Record<string, string | undefined>,
  model?: string,
): ModelConfig {
  const key = keysFromEnv(env)[provider];
  if (!key) throw new Error(`No API key configured for provider "${provider}"`);
  return { provider, apiKey: key, model };
}

export function resolveModelConfig(env: Record<string, string | undefined>): ModelConfig | null {
  const keys = keysFromEnv(env);
  const forced = env.AI_PROVIDER?.trim().toLowerCase() as Provider | undefined;
  if (forced) {
    if (!(forced in keys)) throw new Error(`Unknown AI_PROVIDER "${forced}"`);
    if (!keys[forced]) throw new Error(`AI_PROVIDER is "${forced}" but its API key is not set`);
    return {
      provider: forced,
      apiKey: keys[forced],
      model: env.AI_MODEL || undefined,
      videoFps: env.AI_VIDEO_FPS ? Number(env.AI_VIDEO_FPS) : undefined,
    };
  }
  for (const provider of ["gemini", "perceptron", "qwen", "openrouter", "lovable"] as const) {
    if (keys[provider]) {
      return {
        provider,
        apiKey: keys[provider],
        model: env.AI_MODEL || undefined,
        videoFps: env.AI_VIDEO_FPS ? Number(env.AI_VIDEO_FPS) : undefined,
      };
    }
  }
  return null;
}

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

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === "string" && OUTCOMES.has(v as Outcome);
}

export type ModelConfig = {
  provider: Provider;
  apiKey: string;
  model?: string;
  /**
   * Video sampling rate for providers that support it (Gemini). Default 5 fps
   * for short possession clips — the 1 fps API default literally cannot see
   * fast events (passes, steals, releases), which is where fabrications come
   * from. Override via AI_VIDEO_FPS.
   */
  videoFps?: number;
};

/**
 * One JSON-mode model call over either transport. Retries brief server blips
 * (500/503) twice; rate limits and auth errors surface immediately with
 * user-readable messages. 90s timeout so a hung request can't outlive the
 * serverless wall-clock and leave a row stuck 'processing'.
 */
async function callModel(
  cfg: ModelConfig,
  systemText: string,
  userText: string,
  video: VideoPart | null,
  temperature: number,
): Promise<string> {
  const model = cfg.model ?? DEFAULT_MODEL[cfg.provider];
  // Pro-tier thinking models reason at length before answering; give them
  // more runway than the snappy flash-class models.
  const timeoutMs = /pro/i.test(model) ? 150_000 : 90_000;

  const doFetch = (): Promise<Response> => {
    if (cfg.provider === "gemini") {
      const parts: Array<Record<string, unknown>> = [{ text: userText }];
      if (video) {
        parts.push({
          inline_data: { mime_type: video.mimeType, data: video.base64 },
          video_metadata: { fps: cfg.videoFps ?? 8 },
        });
      }
      return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemText }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature,
              responseMimeType: "application/json",
              // Thinking models spend output budget on reasoning first; without
              // generous headroom the JSON answer gets truncated mid-object.
              maxOutputTokens: 65536,
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    }
    const compat = OPENAI_COMPAT[cfg.provider];
    const content: Array<Record<string, unknown>> = [{ type: "text", text: userText }];
    if (video) {
      if (compat.videoStyle === "file") {
        content.push({
          type: "file",
          file: { filename: "possession.mp4", file_data: video.dataUrl },
        });
      } else {
        // video_url providers accept a fetchable URL (preferred: smaller
        // request, no inline ceiling) or a base64 data URI.
        content.push({
          type: "video_url",
          video_url: { url: video.remoteUrl ?? video.dataUrl },
        });
      }
    }
    return fetch(compat.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content },
        ],
        ...(compat.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  let res: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await doFetch();
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new Error("AI timed out on this clip — try trimming it to a shorter possession");
      }
      throw e;
    }
    if (res.ok || attempt >= 3 || ![500, 503].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }

  if (res.status === 429) throw new Error("Rate limit reached — try again in a minute");
  if (res.status === 402)
    throw new Error(
      cfg.provider === "lovable"
        ? "AI credits exhausted — top up Lovable AI to continue"
        : `AI credits exhausted on ${cfg.provider} — check your account balance`,
    );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI error ${res.status}: ${errText.slice(0, 200)}`);
  }

  if (cfg.provider === "gemini") {
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return json?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? "").join("") || "{}";
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json?.choices?.[0]?.message?.content ?? "{}";
}

/**
 * callModel + parse, with ONE retry on unparseable output. Thinking models
 * occasionally exhaust their budget mid-JSON; a fresh sample usually lands.
 */
async function callModelJson<T>(
  cfg: ModelConfig,
  systemText: string,
  userText: string,
  video: VideoPart | null,
  temperature: number,
): Promise<T> {
  const first = await callModel(cfg, systemText, userText, video, temperature);
  try {
    return parseModelJson<T>(first);
  } catch {
    const second = await callModel(cfg, systemText, userText, video, temperature);
    return parseModelJson<T>(second);
  }
}

/** Text-only JSON generation over either provider (used for scouting reports). */
export async function generateStructuredJson(params: {
  config: ModelConfig;
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  return callModel(params.config, params.system, params.user, null, params.temperature ?? 0.3);
}

export function parseModelJson<T>(content: string): T {
  // Strip accidental markdown fences the model sometimes adds anyway.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    // Fallback: models sometimes wrap the JSON in prose — extract the
    // outermost object and try once more. (Truncated JSON still throws.)
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw e;
  }
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
    team,
    ...(ctx.trackedPlayer?.trim()
      ? [`TRACKED PLAYER (coach this one player personally): ${ctx.trackedPlayer.trim()}`]
      : []),
    ...(ctx.declaredOutcome?.trim()
      ? [
          `DECLARED RESULT (stated by the uploader — treat as fact): this possession ended in ${
            OUTCOME_PHRASE[ctx.declaredOutcome.trim()] ?? ctx.declaredOutcome.trim()
          }.`,
        ]
      : []),
    `Uploader title: ${ctx.title?.trim() || "(none)"}`,
    `Uploader notes: ${ctx.notes?.trim() || "(none)"}`,
    `Clip duration: ~${ctx.durationSec ?? "unknown"}s`,
  ].join("\n");
}

// ---- Pass 1: observation only -------------------------------------------

export type ObservationResponse = {
  readable?: boolean;
  team_in_possession_color?: string;
  tracked_player_found?: boolean;
  observations?: Array<{ t?: unknown; desc?: unknown; certain?: unknown }>;
};

export const OBSERVE_SYSTEM = `You are a meticulous basketball video observer. You are watching ONE possession clip. Your ONLY job is to report what is LITERALLY visible, moment by moment. You do NOT coach, judge, or infer intent.

Hard rules:
- Report events in time order, each with an approximate timestamp (e.g. "0:03").
- Identify players ONLY by jersey color and court location. NEVER invent names or numbers.
- JERSEY-COLOR PHRASING: colors describe JERSEYS, never people. Write "the ball-handler in white at the right wing", "#23 in black", "the defender in the yellow jersey". NEVER put a color word directly before a person word — "the black ball-handler" or "a white player" reads as describing a person's race, which is unacceptable. Always "in <color>" or "<color>-jersey".
- MOVE & CONTEST DISCIPLINE: name a specific move (spin, crossover, euro-step, pump fake, push-off) ONLY if it is unmistakably visible across frames — otherwise describe plainly what changed (direction, position, contact) without naming a move. Report a shot "contest" ONLY if you see a defender's raised hand near the shooter at the release; if a defender falls, initiates, or absorbs contact, describe the visible contact itself (e.g. "the defender falls backward after contact") — do not upgrade it to a contest or downgrade it to nothing. FINISH TYPE: call an attempt a DUNK only when the ball is carried at or above rim level to be thrown down, and a LAYUP only when you see a soft upward release toward the rim/glass; if you cannot tell which, write "finish attempt at the rim" — never default to "layup". Embellished detail is fabrication.
- Set "certain": false whenever the moment is blurry, occluded, off-frame, or too fast to be sure. Do not guess to fill gaps.
- Only report the possession's final result if you actually see it happen on screen.
- If the clip is too low-quality, too short, or not clearly basketball, set "readable": false.
- DECISION SNAPSHOTS: at each decision moment (a shot attempt, a pass, the start of a drive, a lost ball), add one extra observation capturing the OPTIONS on the floor at that instant: where the nearest defender is relative to the actor (distance, side, squared-up or trailing or airborne), and where teammates are (open on the wing? trailing the break? in the corner? none in frame?). If no teammate is visible in frame at that moment, say exactly that. These snapshots decide which alternatives actually existed, so be literal and precise about positions.
- BALL-TRANSFER DISCIPLINE: report a PASS or HANDOFF only if you can actually see the ball leave one player's hands and arrive with another. A screen, two players crossing, or the ball simply appearing somewhere new between sampled moments is NOT evidence of a pass. If you cannot tell how the ball advanced, say exactly that ("ball advanced from the wing to the rim — unclear whether pass or drive") with "certain": false. NEVER invent a pass to explain how the ball got somewhere.
- NEVER BRIDGE A GAP WITH A STORY: when the situation differs between two sampled moments (possession flipped, the ball is suddenly elsewhere, a player is suddenly elsewhere) and you did NOT see the connecting event, record the gap itself: "between ~0:02 and ~0:04 possession changed from the team in black to the team in white — the mechanism was not visible." Do NOT construct a connective narrative — no invented dribbles, no invented advances up the floor, no invented steals-from-behind, no invented passes. A claim that a player traveled somewhere (e.g. "brought it to half court") requires you to have SEEN them along that path. The gap sentence is always the correct answer when you didn't see the bridge.
- EVERY BASKETBALL TERM IS A CLAIM requiring visible evidence — the rules above are instances of one law. Before writing any specific term, ask: did I SEE its defining feature? If not, use the generic fallback:
  · screen/pick → only if a player visibly plants and the on-ball defender collides or alters path; else "two players converge"
  · three-pointer → only if the shooter's feet are visibly behind the arc; else "jump shot" — never guess shot distance
  · steal → only if a defender visibly takes or tips the ball away; a loose ball is "possession lost, cause unclear"
  · block → only if a defender's hand visibly meets the ball; else "the shot missed under pressure"
  · rebound → credit a specific player only if you see them come away holding the ball; else "rebound unclear"
  · foul → only if a whistle stoppage or free throws follow; otherwise describe the contact without ruling on it
  · "wide open" / "heavily contested" → state the defender distance you can actually see instead of the judgment
  · court spots (corner, wing, elbow) → only with visible landmarks (arc, paint, baseline); else the general area
  A generic TRUE sentence always beats a specific guess.
- BODY POSTURE: when clearly visible, record posture facts — defensive stance height (upright vs sitting low), whether the defender slides or crosses feet, passing mechanics (two-hand step-through vs lazy one-hand flick), box-out contact on rebounds, wide vs narrow base. Same claim law: only when clearly visible.
- PLAY-STOPPAGE SIGNALS: watch for signs the play went DEAD mid-clip — most players simultaneously stopping, relaxing, or reversing direction; defenders no longer contesting; the ball casually retrieved or walked back. Record any such signal as its own observation with a timestamp. A basket scored uncontested AFTER such a signal is likely a dead-ball shot (players often finish anyway after a whistle or out-of-bounds) — note that explicitly rather than reporting it as the possession's result.`;

export function observeUserText(ctx: AnalysisContext): string {
  const declared = ctx.declaredOutcome?.trim();
  const declaredRules = declared
    ? `

DECLARED RESULT: the uploader states this possession ended in ${OUTCOME_PHRASE[declared] ?? declared}. Your job includes LOCATING that event: find the moment it happens and observe it in detail (who, where, how it happened). Everything AFTER that moment is dead ball — note it only as post-play, never as the result. If you cannot find any moment matching the declared result, record an explicit observation saying you could not see it — do NOT invent one to match the declaration.`
    : "";
  const tracked = ctx.trackedPlayer?.trim();
  const trackingRules = tracked
    ? `

TRACKED PLAYER: "${tracked}". Locate this player using the description (jersey number and color are the strongest cues; in casual games use clothing and the stated starting spot). Descriptions are sometimes imperfect — a misremembered color, a number the camera never shows. Match on the PREPONDERANCE of cues: if some cues conflict (e.g. the stated number exists but on a different-colored jersey), pick the most likely person, CONTINUE observing normally, and add one explicit observation stating what matched and what conflicted (e.g. "no black jerseys in this clip; #23 wears yellow — treating yellow #23 as the tracked player"). Re-identify them independently in each moment — do not rely on continuous tracking. In every observation where they are involved or visible, refer to them as "the tracked player" plus their appearance. Note what they do AND where they are when off the ball (spacing, cutting, screening, defending). If at any moment you cannot tell whether someone is the tracked player, say so with "certain": false. Set "tracked_player_found": false ONLY if nobody plausibly matches ANY of the cues.`
    : "";
  return `Observe this single basketball possession. Report only what you can see.

${contextBlock(ctx)}${declaredRules}${trackingRules}

Return ONLY valid JSON — no prose, no markdown fences:
{
  "readable": boolean,                  // false if too blurry/short/unclear to analyze reliably
  "team_in_possession_color": string,   // jersey color of the team on offense, or "unclear"
  "tracked_player_found": boolean,      // ONLY meaningful if a tracked player was specified; true if you located them
  "observations": [
    { "t": string, "desc": string, "certain": boolean }
  ]
}`;
}

// ---- Pass 2: coaching analysis grounded in Pass 1 -----------------------

export type JudgeResponse = {
  outcome?: string;
  what_happened?: string;
  what_went_right?: string;
  what_went_wrong?: string;
  alternative?: string;
  confidence?: string;
  flagged?: boolean;
  player_stats?: {
    involved?: unknown;
    shot?: unknown;
    turnover?: unknown;
    good_reads?: unknown;
    bad_decisions?: unknown;
    defense?: unknown;
  };
};

/**
 * Countable events for the tracked player in ONE possession. These feed the
 * rating engine — the model counts, code computes the numbers.
 */
export type PlayerStats = {
  involved: boolean;
  shot: "made" | "missed" | "none";
  turnover: boolean;
  good_reads: number; // 0–3
  bad_decisions: number; // 0–3
  defense: "positive" | "neutral" | "negative" | "na";
};

export const JUDGE_SYSTEM = `You are PlayIQ, an elite basketball film-study analyst. You are given a VERIFIED observation log from a single possession. You did NOT watch the video yourself — build your entire analysis STRICTLY from the log.

Hard rules:
- Do NOT introduce any detail that is not supported by an observation. If the log does not establish something, treat it as unknown and say so.
- Prefer observations with "certain": true. Treat "certain": false as tentative and let it lower your confidence.
- In each field, cite the timestamp(s) you rely on, e.g. "(~0:04)".
- If the log is thin, mostly uncertain, or "readable" was false, set confidence "low", keep claims minimal, and state plainly what could not be determined. Never invent specifics to sound authoritative.
- Use jersey COLORS, never invented names or numbers. Colors describe JERSEYS, never people: write "the ball-handler in black" or "#23 in white" — NEVER "the black ball-handler" or "the white player" (reads as race). Rewrite any such phrasing from the log into the "in <color>" form. Keep every field to 1–3 tight sentences (the "alternative" field may use up to 4).

The "alternative" field is a RIGHT-PLAY analysis, not a platitude. Requirements:
- Scan the log's decision snapshots for what was ACTUALLY available at the key moment (defender position/distance, teammate locations). Choose the best real option. If the log shows no better option existed, say the decision was right and coach the execution instead.
- Name the EXACT technique, not a category: not "a more protected finish" but WHICH finish and WHY it beats that defender's position — e.g. "euro-step left away from the shot-blocker closing from the right", "jump-stop into a pump fake — the defender was airborne", "reverse layup using the rim to shield the trailing defender", "high-glass extension finish off the outside foot". Same for passes ("pocket pass to the roller at the free-throw line") and coverages ("ICE the screen, force baseline").
- NEVER propose an option the log does not show existed. No suggested kick-out unless the log places a teammate somewhere catchable. If the log's snapshots are too thin to know what was available, coach the visible execution (footwork, pace, shot selection) and say what information was missing.

Outcome classification — ALWAYS from the uploader's team's perspective (their jersey color is given in the context). Pick the label for how the possession actually ended:
- made_shot: the uploader's team scored (layup, dunk, jumper, three, and-one).
- missed_shot: the uploader's team took a shot that missed OR was blocked. A blocked shot is missed_shot, NOT a defensive_stop.
- turnover: the uploader's team lost the ball before a shot — steal, intercepted or bad pass, ball knocked out of bounds off them, travel/double-dribble, dribbled off their own foot, offensive foul, or shot-clock violation. If they lost possession and the other team took over, it is a turnover for them.
- foul: use ONLY when a foul is the defining end of the possession and none of made_shot/missed_shot/turnover clearly applies. If they lost the ball, prefer turnover; if a shot went up, prefer made_shot/missed_shot.
- defensive_stop: the uploader's team was DEFENDING and forced a miss or turnover.
- defensive_breakdown: the uploader's team was DEFENDING and gave up an easy score.
- other: genuinely none of the above, or too unclear to tell.
Uploaders almost always film their OWN team's offense. When you are not clearly certain the uploader's team was defending, assume they were on OFFENSE and label made_shot / missed_shot / turnover — do NOT reach for defensive_stop / defensive_breakdown just because the team identity is ambiguous.
If the log does not let you confidently tell which team is the uploader's by jersey color (e.g. dark blue vs black), say so in what_happened and set confidence "low".

Dead-ball awareness: if the log records stoppage signals (players simultaneously stopping or reversing, defenders no longer contesting) BEFORE a basket, the possession ended at the stoppage — do NOT count that basket as the outcome. If the log shows the play ended but not HOW it ended, use outcome "other", set confidence "low", and say plainly in what_happened that the ending could not be determined from the video. Admitting "unclear" is always better than guessing a concrete outcome.

Role awareness — judge every player against their APPARENT ROLE in the action, not against proximity to the ball:
- Standard, role-correct behavior is NEVER "what went wrong": spacing to the corner during a drive, holding weak-side position, screening and holding, the roller rolling, a shooter lifting to the wing. These are players doing their jobs.
- Only flag genuine deviations that hurt the possession: abandoning spacing to crowd the ball, missing an open read the log shows, late/no rotation on defense, forcing over a set advantage.
- If the possession was executed fine, SAY SO — leave what_went_wrong empty rather than inventing a critique.`;

export function judgeUserText(ctx: AnalysisContext, observation: ObservationResponse): string {
  const declared = ctx.declaredOutcome?.trim();
  const declaredJudgeRules = declared
    ? `

DECLARED RESULT MODE: the uploader states the possession ended in ${OUTCOME_PHRASE[declared] ?? declared} — set "outcome" to exactly "${declared}". Anchor the entire analysis on the located event; anything the log marks as after it is dead ball and must not shape the critique. If the log says the event could not be seen, keep the declared outcome but set confidence "low" and say plainly that the moment could not be identified on video — NEVER fabricate details of an event the log does not contain.`
    : "";
  const tracked = ctx.trackedPlayer?.trim();
  const personalRules = tracked
    ? `

PERSONAL COACHING MODE for the tracked player ("${tracked}"):
- MATCH DISCLOSURE: if the log notes the description didn't fully match (wrong color, number unseen), open what_happened with ONE short sentence disclosing who you were matched to and why (e.g. "Heads up: no #23 in black in this clip — you were matched to the player in yellow #23"), then coach normally at full depth. Do not lower confidence just because one cue was off while a strong cue (number, unique accessory) matched.
- SPEAK TO THE PLAYER IN SECOND PERSON: in every field, address the tracked player as "you" — "You attacked the middle", "You should angle your stance" — never "the tracked player" or third-person descriptions of them. Other players stay described by jersey ("the defender in white"). On first mention you may anchor identity once ("you (#5 in blue)").
- what_went_right / what_went_wrong / alternative must be about YOUR decisions, positioning, effort, and reads — on and off the ball — not the team in general. what_happened still summarizes the possession, but center your involvement in it.
- Apply the role-awareness rules to them: if their job on this possession was to space, screen, or hold weak-side, doing that is correct — do not criticize it.
- POSTURE: when the log records posture facts about you (upright defensive stance, crossed feet, lazy one-hand pass, no box-out), coach them concretely — stance height and footwork on defense, two-hand passing mechanics, base width. Only from the log; never assume posture that wasn't observed.
- If the log says the tracked player was not found (tracked_player_found: false) or their involvement is mostly uncertain, say plainly that they could not be identified in this clip, keep all personal claims out, and set confidence "low".`
    : "";
  return `Here is the verified observation log for one possession.

${contextBlock(ctx)}${declaredJudgeRules}${personalRules}

Observation log (JSON):
${JSON.stringify(
  {
    readable: observation.readable ?? true,
    team_in_possession_color: observation.team_in_possession_color ?? "unclear",
    ...(tracked ? { tracked_player_found: observation.tracked_player_found ?? null } : {}),
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
  "alternative": string,       // RIGHT-PLAY analysis (up to 4 sentences): best REAL option per the log's decision snapshots + the exact technique to execute it. If the decision was right, coach the execution. Never propose options the log doesn't show. "" only if truly nothing to coach.
  "confidence": "low"|"medium"|"high",  // "high" ONLY if the log is dense and mostly certain.
  "flagged": boolean${
    tracked
      ? `,           // true if this is a strong, clear teaching moment.
  "player_stats": {            // Count ONLY the tracked player's events in THIS possession, grounded in the log. Be strict: no event in the log = don't count it.
    "involved": boolean,       // did they meaningfully participate (touch, screen, contest, rotation)?
    "shot": "made"|"missed"|"none",
    "turnover": boolean,       // did THEY commit a turnover?
    "good_reads": 0|1|2|3,     // correct decisions the log supports (right pass, good cut, correct rotation)
    "bad_decisions": 0|1|2|3,  // clear mistakes the log supports (forced shot, blown assignment, lazy pass)
    "defense": "positive"|"neutral"|"negative"|"na"  // their defensive impact this possession; "na" if their team wasn't defending
  }`
      : "           // true if this is a strong, clear teaching moment."
  }
}`;
}

// ---- Pure normalization (validated + clamped; unit-tested) --------------

/** Coerce the model's loose observation array into clean, typed rows. */
export function normalizeObservations(raw: unknown): Observation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => ({
    t: String((o as Observation)?.t ?? ""),
    desc: String((o as Observation)?.desc ?? ""),
    certain: Boolean((o as Observation)?.certain),
  }));
}

/**
 * Turn the two raw model responses into a safe AnalysisResult:
 * unknown outcomes collapse to "other", unknown confidence to "low",
 * blank optional fields to "", and every text field is length-capped.
 */
export function normalizeAnalysis(
  observation: ObservationResponse,
  judged: JudgeResponse,
  trackingRequested = false,
): AnalysisResult {
  const rawOutcome = String(judged.outcome ?? "other") as Outcome;
  const rawConf = String(judged.confidence ?? "low") as Confidence;
  const readable = observation.readable !== false;
  const trackedFound = !trackingRequested
    ? null
    : observation.tracked_player_found === false
      ? false
      : observation.tracked_player_found === true
        ? true
        : null;
  // A clip the observer flagged unreadable — or personal coaching for a player
  // the observer couldn't find — can never carry high/medium confidence.
  const capLow = !readable || trackedFound === false;
  return {
    outcome: OUTCOMES.has(rawOutcome) ? rawOutcome : "other",
    confidence: capLow ? "low" : CONFIDENCES.has(rawConf) ? rawConf : "low",
    what_happened: String(judged.what_happened ?? "").slice(0, 2000),
    what_went_right: judged.what_went_right ? String(judged.what_went_right).slice(0, 2000) : "",
    what_went_wrong: judged.what_went_wrong ? String(judged.what_went_wrong).slice(0, 2000) : "",
    alternative: judged.alternative ? String(judged.alternative).slice(0, 2000) : "",
    flagged: Boolean(judged.flagged),
    readable,
    observations: normalizeObservations(observation.observations),
    tracked_player_found: trackedFound,
    player_stats: trackingRequested ? normalizePlayerStats(judged.player_stats) : null,
  };
}

const SHOT_VALUES = new Set(["made", "missed", "none"]);
const DEFENSE_VALUES = new Set(["positive", "neutral", "negative", "na"]);

/** Clamp the judge's loose stat block into a typed PlayerStats (or null). */
export function normalizePlayerStats(raw: JudgeResponse["player_stats"]): PlayerStats | null {
  if (!raw || typeof raw !== "object") return null;
  const clampCount = (v: unknown) =>
    Math.max(0, Math.min(3, Math.round(typeof v === "number" ? v : Number(v) || 0)));
  const shot = String(raw.shot ?? "none");
  const defense = String(raw.defense ?? "na");
  return {
    involved: Boolean(raw.involved),
    shot: (SHOT_VALUES.has(shot) ? shot : "none") as PlayerStats["shot"],
    turnover: Boolean(raw.turnover),
    good_reads: clampCount(raw.good_reads),
    bad_decisions: clampCount(raw.bad_decisions),
    defense: (DEFENSE_VALUES.has(defense) ? defense : "na") as PlayerStats["defense"],
  };
}

// ---- Public entry point -------------------------------------------------

export async function runPossessionAnalysis(params: {
  videoDataUrl: string;
  apiKey: string;
  context: AnalysisContext;
  /** Transport: lovable (default) | gemini | perceptron | qwen. */
  provider?: Provider;
  /** Optional model override; sensible per-provider default otherwise. */
  model?: string;
  /**
   * Optional short-lived fetchable URL for the same video (e.g. a signed
   * storage URL). video_url-style providers (perceptron/qwen) use it instead
   * of inline base64.
   */
  videoRemoteUrl?: string;
  /**
   * HYBRID MODE: run Pass 1 (the video observer) on a different model than
   * Pass 2 (the judge) — e.g. a perception specialist watches, a stronger
   * reasoner coaches. Omit to use the main config for both passes.
   */
  observer?: ModelConfig;
}): Promise<AnalysisResult> {
  const { videoDataUrl, apiKey, context } = params;
  const cfg: ModelConfig = {
    provider: params.provider ?? "lovable",
    apiKey,
    model: params.model,
  };
  const video = parseDataUrl(videoDataUrl, params.videoRemoteUrl);

  // Pass 1 — watch and observe (low temperature: stay literal).
  const observerCfg = params.observer ?? cfg;
  const obs = await callModelJson<ObservationResponse>(
    observerCfg,
    OBSERVE_SYSTEM,
    observeUserText(context),
    video,
    0.15,
  );

  // Pass 2 — coach the play from the log only (no video, slightly warmer).
  const judged = await callModelJson<JudgeResponse>(
    cfg,
    JUDGE_SYSTEM,
    judgeUserText(context, obs),
    null,
    0.2,
  );

  return normalizeAnalysis(obs, judged, Boolean(context.trackedPlayer?.trim()));
}

// ---- Jumpshot mechanics pipeline ----------------------------------------

export const JUMPSHOT_OBSERVE_SYSTEM = `You are a meticulous shooting-form observer watching a short clip of ONE player's jumpshot (possibly several reps). Report ONLY visible mechanics, moment by moment with timestamps. Refer to the player as "the shooter". Cover, when visible: base (feet width, alignment, stagger) at the catch/set; knee bend depth; the dip; set point location; elbow position relative to the shoulder line; guide-hand placement and whether it moves, pushes, or thumb-flicks at release; release timing relative to jump peak; wrist snap and follow-through hold; landing spot vs takeoff (drift); head/eyes. Note whether each rep goes in ONLY if the rim result is visible. The claim law applies: report only what you SEE; if the camera angle hides something (e.g. guide hand blocked), say exactly that with "certain": false. Never infer a flaw you cannot see.`;

export const JUMPSHOT_JUDGE_SYSTEM = `You are PlayIQ's shooting coach, working from a VERIFIED mechanics log (you did not watch the video). Great shooters have wildly different forms — form diversity is legitimate, and style is not a flaw. You flag ONLY mechanics with a clear causal path to misses or inconsistency, e.g.: guide-hand thumb flick or push at release (adds side-spin → left/right misses), elbow far outside the shoulder line drifting the ball, no leg drive / energy leak (short misses), inconsistent set point or a hitch across reps, crossed or drifting base, head dropping, cut-off follow-through. For every flaw you flag: cite the timestamp, the visible evidence, WHY it costs makes (which miss it produces), and one concrete drill to fix it. If a quirk is unusual but consistent and not costing anything (low set point, narrow stance), SAY it is fine. "Your mechanics look sound" is a valid and welcome verdict — never invent flaws to seem thorough. Speak to the shooter in SECOND PERSON ("Your guide-hand thumb pushes the ball at release (~0:02)"). If the log is thin or the angle hid key mechanics, say what could not be assessed and set confidence low.`;

export function jumpshotJudgeUserText(observation: ObservationResponse): string {
  return `Mechanics log for the jumpshot clip (JSON):
${JSON.stringify(
  {
    readable: observation.readable ?? true,
    observations: observation.observations ?? [],
  },
  null,
  2,
)}

Return ONLY valid JSON — no prose, no markdown fences:
{
  "shot_result": "made"|"missed"|"unclear",   // only if the rim result was in the log
  "form_summary": string,      // 2-4 sentences: your form as observed, timestamps cited, second person
  "whats_working": string,     // mechanics that are solid or fine-though-unusual. "" if none assessable.
  "harmful_flaws": string,     // ONLY flaws with a causal path to misses: evidence + timestamp + why it costs makes. "" if mechanics are sound.
  "fix_drills": string,        // one concrete drill per flagged flaw. "" if nothing to fix.
  "confidence": "low"|"medium"|"high"
}`;
}

type JumpshotJudgeResponse = {
  shot_result?: string;
  form_summary?: string;
  whats_working?: string;
  harmful_flaws?: string;
  fix_drills?: string;
  confidence?: string;
};

export async function runJumpshotAnalysis(params: {
  videoDataUrl: string;
  apiKey: string;
  provider?: Provider;
  model?: string;
  videoRemoteUrl?: string;
  notes?: string | null;
}): Promise<AnalysisResult> {
  const cfg: ModelConfig = {
    provider: params.provider ?? "lovable",
    apiKey: params.apiKey,
    model: params.model,
  };
  const video = parseDataUrl(params.videoDataUrl, params.videoRemoteUrl);
  const observeUser = `Observe this jumpshot clip rep by rep.${params.notes?.trim() ? `\nShooter's note: ${params.notes.trim()}` : ""}

Return ONLY valid JSON — no prose, no markdown fences:
{
  "readable": boolean,               // false if too blurry/short/wrong angle to assess mechanics
  "observations": [ { "t": string, "desc": string, "certain": boolean } ]
}`;
  const obs = await callModelJson<ObservationResponse>(
    cfg,
    JUMPSHOT_OBSERVE_SYSTEM,
    observeUser,
    video,
    0.15,
  );
  const judged = await callModelJson<JumpshotJudgeResponse>(
    cfg,
    JUMPSHOT_JUDGE_SYSTEM,
    jumpshotJudgeUserText(obs),
    null,
    0.2,
  );
  const readable = obs.readable !== false;
  const conf = String(judged.confidence ?? "low") as Confidence;
  const result = String(judged.shot_result ?? "unclear");
  return {
    outcome: result === "made" ? "made_shot" : result === "missed" ? "missed_shot" : "other",
    what_happened: String(judged.form_summary ?? "").slice(0, 2000),
    what_went_right: judged.whats_working ? String(judged.whats_working).slice(0, 2000) : "",
    what_went_wrong: judged.harmful_flaws ? String(judged.harmful_flaws).slice(0, 2000) : "",
    alternative: judged.fix_drills ? String(judged.fix_drills).slice(0, 2000) : "",
    confidence: !readable ? "low" : CONFIDENCES.has(conf) ? conf : "low",
    flagged: false,
    readable,
    observations: normalizeObservations(obs.observations),
    tracked_player_found: null,
    player_stats: null,
  };
}
