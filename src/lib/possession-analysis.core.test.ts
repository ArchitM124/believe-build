import { test, expect, afterEach } from "bun:test";
import {
  parseModelJson,
  normalizeObservations,
  normalizeAnalysis,
  normalizePlayerStats,
  runPossessionAnalysis,
  resolveModelConfig,
  observeUserText,
  judgeUserText,
} from "./possession-analysis.core";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- parseModelJson: the model sometimes wraps JSON in markdown fences ----

type Parsed = { a: number };

test("parseModelJson reads plain JSON", () => {
  expect(parseModelJson<Parsed>('{"a":1}')).toEqual({ a: 1 });
});

test("parseModelJson strips ```json fences", () => {
  expect(parseModelJson<Parsed>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
});

test("parseModelJson strips bare ``` fences", () => {
  expect(parseModelJson<Parsed>('```\n{"a":1}\n```')).toEqual({ a: 1 });
});

test("parseModelJson throws on non-JSON (caller marks the clip failed)", () => {
  expect(() => parseModelJson("sorry, I can't do that")).toThrow();
});

test("parseModelJson extracts an object wrapped in prose", () => {
  expect(parseModelJson<Parsed>('Here is the analysis: {"a":1} Hope that helps!')).toEqual({
    a: 1,
  });
});

// ---- normalizeObservations: coerce the model's loose array --------------

test("normalizeObservations returns [] for non-arrays", () => {
  expect(normalizeObservations(undefined)).toEqual([]);
  expect(normalizeObservations(null)).toEqual([]);
  expect(normalizeObservations("nope")).toEqual([]);
});

test("normalizeObservations coerces field types", () => {
  expect(normalizeObservations([{ t: 3, desc: 5, certain: "yes" }])).toEqual([
    { t: "3", desc: "5", certain: true },
  ]);
  expect(normalizeObservations([{}])).toEqual([{ t: "", desc: "", certain: false }]);
});

// ---- normalizeAnalysis: the safety net around the model's output --------

test("normalizeAnalysis collapses an unknown outcome to 'other'", () => {
  const r = normalizeAnalysis(
    { readable: true, observations: [] },
    { outcome: "dunk", confidence: "high", what_happened: "x" },
  );
  expect(r.outcome).toBe("other");
  expect(r.confidence).toBe("high");
});

test("normalizeAnalysis collapses an unknown confidence to 'low'", () => {
  const r = normalizeAnalysis({}, { outcome: "turnover", confidence: "certain" });
  expect(r.outcome).toBe("turnover");
  expect(r.confidence).toBe("low");
});

test("normalizeAnalysis blanks missing optional fields and coerces flagged", () => {
  const r = normalizeAnalysis({}, { outcome: "foul", what_happened: "contact" });
  expect(r.what_went_right).toBe("");
  expect(r.what_went_wrong).toBe("");
  expect(r.alternative).toBe("");
  expect(r.flagged).toBe(false);
});

test("normalizeAnalysis treats readable:false as unreadable, else readable", () => {
  expect(normalizeAnalysis({ readable: false }, {}).readable).toBe(false);
  expect(normalizeAnalysis({}, {}).readable).toBe(true);
});

test("normalizeAnalysis forces low confidence when the clip is unreadable", () => {
  // Even if the judge pass sounds certain, an unreadable clip can't be trusted.
  const r = normalizeAnalysis({ readable: false }, { outcome: "made_shot", confidence: "high" });
  expect(r.confidence).toBe("low");
});

// ---- player tracking ------------------------------------------------------

test("tracked_player_found is null when tracking was not requested", () => {
  const r = normalizeAnalysis({ tracked_player_found: true }, { outcome: "made_shot" });
  expect(r.tracked_player_found).toBe(null);
});

test("tracked_player_found passes through when tracking was requested", () => {
  expect(normalizeAnalysis({ tracked_player_found: true }, {}, true).tracked_player_found).toBe(
    true,
  );
  expect(normalizeAnalysis({ tracked_player_found: false }, {}, true).tracked_player_found).toBe(
    false,
  );
  // Model omitted the field entirely — unknown, not false.
  expect(normalizeAnalysis({}, {}, true).tracked_player_found).toBe(null);
});

test("personal coaching for an unfound player is forced to low confidence", () => {
  const r = normalizeAnalysis(
    { readable: true, tracked_player_found: false },
    { outcome: "made_shot", confidence: "high" },
    true,
  );
  expect(r.confidence).toBe("low");
});

test("observer prompt demands decision snapshots; judge demands grounded technique", async () => {
  const { OBSERVE_SYSTEM, JUDGE_SYSTEM } = await import("./possession-analysis.core");
  expect(OBSERVE_SYSTEM).toContain("DECISION SNAPSHOTS");
  expect(OBSERVE_SYSTEM).toContain("PLAY-STOPPAGE SIGNALS");
  expect(OBSERVE_SYSTEM).toContain("BALL-TRANSFER DISCIPLINE");
  expect(OBSERVE_SYSTEM).toContain("NEVER invent a pass");
  expect(OBSERVE_SYSTEM).toContain("NEVER BRIDGE A GAP WITH A STORY");
  expect(OBSERVE_SYSTEM).toContain("the mechanism was not visible");
  expect(OBSERVE_SYSTEM).toContain("JERSEY-COLOR PHRASING");
  expect(OBSERVE_SYSTEM).toContain("colors describe JERSEYS, never people");
  expect(OBSERVE_SYSTEM).not.toContain('"white ball-handler');
  expect(OBSERVE_SYSTEM).toContain("MOVE & CONTEST DISCIPLINE");
  expect(OBSERVE_SYSTEM).toContain("Embellished detail is fabrication");
  expect(OBSERVE_SYSTEM).toContain("FINISH TYPE");
  expect(OBSERVE_SYSTEM).toContain('never default to "layup"');
  expect(OBSERVE_SYSTEM).toContain("EVERY BASKETBALL TERM IS A CLAIM");
  expect(OBSERVE_SYSTEM).toContain("A generic TRUE sentence always beats a specific guess");
  expect(JUDGE_SYSTEM).toContain("never people");
  expect(JUDGE_SYSTEM).toContain("Dead-ball awareness");
  expect(JUDGE_SYSTEM).toContain("RIGHT-PLAY analysis");
  expect(JUDGE_SYSTEM).toContain("EXACT technique");
  expect(JUDGE_SYSTEM).toContain("NEVER propose an option the log does not show existed");
});

test("prompts include tracking instructions only when a player is set", () => {
  const withPlayer = { role: "player", trackedPlayer: "white #23" };
  const without = { role: "player" };
  expect(observeUserText(withPlayer)).toContain("white #23");
  expect(observeUserText(withPlayer)).toContain("TRACKED PLAYER");
  expect(observeUserText(without)).not.toContain("TRACKED PLAYER");
  expect(judgeUserText(withPlayer, {})).toContain("PERSONAL COACHING MODE");
  expect(judgeUserText(withPlayer, {})).toContain("SECOND PERSON");
  expect(judgeUserText(withPlayer, {})).toContain("MATCH DISCLOSURE");
  expect(observeUserText(withPlayer)).toContain("PREPONDERANCE of cues");
  expect(observeUserText(withPlayer)).toContain("what matched and what conflicted");
  expect(judgeUserText(without, {})).not.toContain("PERSONAL COACHING MODE");
});

test("normalizePlayerStats clamps and defaults the judge's loose stat block", () => {
  expect(normalizePlayerStats(undefined)).toBe(null);
  expect(
    normalizePlayerStats({
      involved: "yes",
      shot: "dunked",
      turnover: 0,
      good_reads: 7,
      bad_decisions: -2,
      defense: "elite",
    }),
  ).toEqual({
    involved: true,
    shot: "none",
    turnover: false,
    good_reads: 3,
    bad_decisions: 0,
    defense: "na",
  });
});

test("player_stats flows through normalizeAnalysis only when tracking", () => {
  const judged = {
    outcome: "made_shot",
    player_stats: {
      involved: true,
      shot: "made",
      turnover: false,
      good_reads: 1,
      bad_decisions: 0,
      defense: "na",
    },
  };
  expect(normalizeAnalysis({}, judged, true).player_stats?.shot).toBe("made");
  expect(normalizeAnalysis({}, judged, false).player_stats).toBe(null);
});

test("judge schema asks for player_stats only in tracking mode", () => {
  expect(judgeUserText({ role: "player", trackedPlayer: "white #23" }, {})).toContain(
    '"player_stats"',
  );
  expect(judgeUserText({ role: "coach" }, {})).not.toContain('"player_stats"');
});

test("gemini provider hits Google's API with the right shape", async () => {
  const urls: string[] = [];
  const geminiResponse = (obj: unknown): Response =>
    ({
      status: 200,
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
      text: async () => "",
    }) as unknown as Response;
  let calls = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    calls++;
    if (calls === 1) return geminiResponse({ readable: true, observations: [] });
    return geminiResponse({ outcome: "turnover", confidence: "medium" });
  }) as unknown as typeof fetch;

  const result = await runPossessionAnalysis({
    videoDataUrl: "data:video/mp4;base64,AAAA",
    apiKey: "google-key",
    provider: "gemini",
    model: "gemini-2.5-pro",
    context: { role: "coach" },
  });

  expect(urls[0]).toContain("generativelanguage.googleapis.com");
  expect(urls[0]).toContain("gemini-2.5-pro");
  expect(result.outcome).toBe("turnover");
});

test("perceptron/qwen send video_url (preferring a remote URL) without json mode", async () => {
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const openaiResponse = (obj: unknown): Response =>
    ({
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
      text: async () => "",
    }) as unknown as Response;
  let calls = 0;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    calls++;
    if (calls === 1) return openaiResponse({ readable: true, observations: [] });
    return openaiResponse({ outcome: "made_shot", confidence: "medium" });
  }) as unknown as typeof fetch;

  const result = await runPossessionAnalysis({
    videoDataUrl: "data:video/mp4;base64,AAAA",
    videoRemoteUrl: "https://signed.example/clip.mp4",
    apiKey: "p-key",
    provider: "perceptron",
    context: { role: "coach" },
  });

  expect(captured[0].url).toContain("api.perceptron.inc");
  expect(captured[0].body.model).toBe("perceptron-mk1");
  expect(captured[0].body.response_format).toBeUndefined();
  const content = (captured[0].body.messages as Array<{ content: unknown }>)[1].content as Array<
    Record<string, unknown>
  >;
  const videoPart = content.find((p) => p.type === "video_url") as {
    video_url: { url: string };
  };
  expect(videoPart.video_url.url).toBe("https://signed.example/clip.mp4");
  expect(result.outcome).toBe("made_shot");
});

test("qwen provider targets the DashScope endpoint with its default model", async () => {
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const openaiResponse = (obj: unknown): Response =>
    ({
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
      text: async () => "",
    }) as unknown as Response;
  let calls = 0;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)));
    calls++;
    if (calls === 1) return openaiResponse({ readable: true, observations: [] });
    return openaiResponse({ outcome: "turnover", confidence: "low" });
  }) as unknown as typeof fetch;

  const result = await runPossessionAnalysis({
    videoDataUrl: "data:video/mp4;base64,AAAA",
    apiKey: "q-key",
    provider: "qwen",
    context: { role: "coach" },
  });

  expect(urls[0]).toContain("dashscope-intl.aliyuncs.com");
  expect(bodies[0].model).toBe("qwen3-vl-plus");
  expect(result.outcome).toBe("turnover");
});

test("hybrid mode: observer config runs pass 1, main config runs pass 2", async () => {
  const urls: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    calls++;
    if (calls === 1) {
      // Pass 1 lands on the OpenRouter (observer) endpoint — OpenAI shape.
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ readable: true, observations: [] }) } }],
        }),
        text: async () => "",
      } as unknown as Response;
    }
    // Pass 2 lands on Google (judge) — Gemini shape.
    return {
      status: 200,
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ outcome: "made_shot", confidence: "high" }) }],
            },
          },
        ],
      }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await runPossessionAnalysis({
    videoDataUrl: "data:video/mp4;base64,AAAA",
    apiKey: "google-key",
    provider: "gemini",
    observer: { provider: "openrouter", apiKey: "or-key" },
    context: { role: "coach" },
  });

  expect(urls[0]).toContain("openrouter.ai");
  expect(urls[1]).toContain("generativelanguage.googleapis.com");
  expect(result.outcome).toBe("made_shot");
});

test("resolveProviderConfig returns a specific provider's config or throws", async () => {
  const { resolveProviderConfig } = await import("./possession-analysis.core");
  const cfg = resolveProviderConfig("openrouter", { OPENROUTER_API_KEY: "or" }, "m");
  expect(cfg).toEqual({ provider: "openrouter", apiKey: "or", model: "m" });
  expect(() => resolveProviderConfig("qwen", {})).toThrow();
});

test("resolveModelConfig picks by priority and honors AI_PROVIDER", () => {
  expect(resolveModelConfig({})).toBe(null);
  expect(resolveModelConfig({ LOVABLE_API_KEY: "l" })?.provider).toBe("lovable");
  expect(resolveModelConfig({ LOVABLE_API_KEY: "l", QWEN_API_KEY: "q" })?.provider).toBe("qwen");
  expect(resolveModelConfig({ QWEN_API_KEY: "q", PERCEPTRON_API_KEY: "p" })?.provider).toBe(
    "perceptron",
  );
  expect(resolveModelConfig({ PERCEPTRON_API_KEY: "p", GEMINI_API_KEY: "g" })?.provider).toBe(
    "gemini",
  );
  // Explicit override wins over priority.
  const forced = resolveModelConfig({
    GEMINI_API_KEY: "g",
    QWEN_API_KEY: "q",
    AI_PROVIDER: "qwen",
    AI_MODEL: "qwen3-vl-max",
  });
  expect(forced?.provider).toBe("qwen");
  expect(forced?.model).toBe("qwen3-vl-max");
  // DASHSCOPE_API_KEY is an accepted alias for qwen.
  expect(resolveModelConfig({ DASHSCOPE_API_KEY: "d" })?.provider).toBe("qwen");
  // Forcing a provider without its key is a loud error, not a silent fallback.
  expect(() => resolveModelConfig({ AI_PROVIDER: "perceptron" })).toThrow();
});

test("declared outcome anchors both prompts and forbids fabrication", () => {
  const declared = { role: "coach", declaredOutcome: "turnover" };
  const without = { role: "coach" };
  expect(observeUserText(declared)).toContain("DECLARED RESULT");
  expect(observeUserText(declared)).toContain("a turnover");
  expect(observeUserText(declared)).toContain("do NOT invent one");
  expect(observeUserText(without)).not.toContain("DECLARED RESULT");
  expect(judgeUserText(declared, {})).toContain('set "outcome" to exactly "turnover"');
  expect(judgeUserText(declared, {})).toContain("NEVER fabricate");
  expect(judgeUserText(without, {})).not.toContain("DECLARED RESULT MODE");
});

test("normalizeAnalysis caps long text fields at 2000 chars", () => {
  const long = "a".repeat(5000);
  const r = normalizeAnalysis({}, { outcome: "made_shot", what_happened: long });
  expect(r.what_happened.length).toBe(2000);
});

// ---- runPossessionAnalysis: the two-pass flow, with a stubbed gateway ----

function gatewayResponse(content: string, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  } as unknown as Response;
}

test("runPossessionAnalysis makes two calls and returns a normalized result", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) {
      return gatewayResponse(
        JSON.stringify({
          readable: true,
          team_in_possession_color: "white",
          observations: [{ t: "0:01", desc: "white drives right", certain: true }],
        }),
      );
    }
    return gatewayResponse(
      JSON.stringify({
        outcome: "made_shot",
        what_happened: "white scores at the rim (~0:01)",
        confidence: "high",
        flagged: true,
      }),
    );
  }) as unknown as typeof fetch;

  const result = await runPossessionAnalysis({
    videoDataUrl: "data:video/mp4;base64,AAAA",
    apiKey: "test-key",
    context: { role: "coach", teamColor: "white" },
  });

  expect(calls).toBe(2); // pass 1 (observe) + pass 2 (judge)
  expect(result.outcome).toBe("made_shot");
  expect(result.confidence).toBe("high");
  expect(result.flagged).toBe(true);
  expect(result.readable).toBe(true);
  expect(result.observations).toHaveLength(1);
});

test("runPossessionAnalysis surfaces a friendly error on rate limit (429)", async () => {
  globalThis.fetch = (async () => gatewayResponse("", 429)) as unknown as typeof fetch;
  await expect(
    runPossessionAnalysis({
      videoDataUrl: "data:video/mp4;base64,AAAA",
      apiKey: "test-key",
      context: { role: "coach" },
    }),
  ).rejects.toThrow(/rate limit/i);
});

// ---- jumpshot mechanics pipeline ----------------------------------------

test("jumpshot prompts: harmful-flaws-only philosophy, thumb flicks, sound-verdict allowed", async () => {
  const { JUMPSHOT_OBSERVE_SYSTEM, JUMPSHOT_JUDGE_SYSTEM } =
    await import("./possession-analysis.core");
  expect(JUMPSHOT_OBSERVE_SYSTEM).toContain("thumb-flick");
  expect(JUMPSHOT_OBSERVE_SYSTEM).toContain("Never infer a flaw you cannot see");
  expect(JUMPSHOT_JUDGE_SYSTEM).toContain("form diversity is legitimate");
  expect(JUMPSHOT_JUDGE_SYSTEM).toContain("thumb flick");
  expect(JUMPSHOT_JUDGE_SYSTEM).toContain('"Your mechanics look sound" is a valid');
  expect(JUMPSHOT_JUDGE_SYSTEM).toContain("SECOND PERSON");
  expect(JUMPSHOT_JUDGE_SYSTEM).toContain("never invent flaws");
});

test("runJumpshotAnalysis maps the mechanics verdict into AnalysisResult", async () => {
  const { runJumpshotAnalysis } = await import("./possession-analysis.core");
  const openaiResponse = (obj: unknown): Response =>
    ({
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
      text: async () => "",
    }) as unknown as Response;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) {
      return openaiResponse({
        readable: true,
        observations: [{ t: "0:01", desc: "guide-hand thumb pushes at release", certain: true }],
      });
    }
    return openaiResponse({
      shot_result: "missed",
      form_summary: "Your base is square; your guide-hand thumb pushes at release (~0:01).",
      whats_working: "Your base and dip are consistent.",
      harmful_flaws: "Guide-hand thumb flick at release adds side-spin (~0:01).",
      fix_drills: "One-hand form shooting from 5 feet, guide hand behind your back.",
      confidence: "high",
    });
  }) as unknown as typeof fetch;

  const r = await runJumpshotAnalysis({
    videoDataUrl: "data:video/mp4;base64,AAAA",
    apiKey: "k",
    provider: "lovable",
  });
  expect(calls).toBe(2);
  expect(r.outcome).toBe("missed_shot");
  expect(r.what_went_wrong).toContain("thumb flick");
  expect(r.alternative).toContain("form shooting");
  expect(r.confidence).toBe("high");
  expect(r.player_stats).toBe(null);
});
