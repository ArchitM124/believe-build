import { test, expect, afterEach } from "bun:test";
import {
  parseModelJson,
  normalizeObservations,
  normalizeAnalysis,
  runPossessionAnalysis,
} from "./possession-analysis.core";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- parseModelJson: the model sometimes wraps JSON in markdown fences ----

test("parseModelJson reads plain JSON", () => {
  expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
});

test("parseModelJson strips ```json fences", () => {
  expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
});

test("parseModelJson strips bare ``` fences", () => {
  expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
});

test("parseModelJson throws on non-JSON (caller marks the clip failed)", () => {
  expect(() => parseModelJson("sorry, I can't do that")).toThrow();
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
