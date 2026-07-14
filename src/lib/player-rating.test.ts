import { test, expect } from "bun:test";
import { computeRating, MIN_POSSESSIONS } from "./player-rating";
import type { PlayerStats } from "./possession-analysis.core";

const poss = (over: Partial<PlayerStats> = {}): PlayerStats => ({
  involved: true,
  shot: "none",
  turnover: false,
  good_reads: 0,
  bad_decisions: 0,
  defense: "na",
  ...over,
});

test("refuses to rate with fewer than MIN_POSSESSIONS", () => {
  expect(() => computeRating([poss(), poss()])).toThrow(String(MIN_POSSESSIONS));
});

test("a clean, productive session rates high; a sloppy one rates low", () => {
  const great = computeRating([
    poss({ shot: "made", good_reads: 2 }),
    poss({ shot: "made", good_reads: 1 }),
    poss({ good_reads: 1, defense: "positive" }),
    poss({ shot: "made", good_reads: 2 }),
  ]);
  const rough = computeRating([
    poss({ turnover: true, bad_decisions: 2 }),
    poss({ shot: "missed", bad_decisions: 1 }),
    poss({ turnover: true, bad_decisions: 2, defense: "negative" }),
    poss({ shot: "missed", turnover: true, bad_decisions: 1 }),
  ]);
  expect(great.overall).toBeGreaterThan(80);
  expect(rough.overall).toBeLessThan(55);
  expect(great.overall).toBeGreaterThan(rough.overall);
});

test("no shots taken → scoring is null and overall reweights around it", () => {
  const r = computeRating([
    poss({ good_reads: 1 }),
    poss({ good_reads: 2 }),
    poss({ defense: "positive" }),
  ]);
  expect(r.subScores.scoring).toBe(null);
  expect(r.overall).toBeGreaterThanOrEqual(25);
  expect(r.overall).toBeLessThanOrEqual(99);
});

test("no defensive possessions → defense is null", () => {
  const r = computeRating([poss(), poss(), poss()]);
  expect(r.subScores.defense).toBe(null);
});

test("scores are clamped to the 25–99 range", () => {
  const nightmare = computeRating(
    Array.from({ length: 5 }, () =>
      poss({
        shot: "missed",
        turnover: true,
        bad_decisions: 3,
        defense: "negative",
        involved: false,
      }),
    ),
  );
  for (const v of Object.values(nightmare.subScores)) {
    if (v !== null) {
      expect(v).toBeGreaterThanOrEqual(25);
      expect(v).toBeLessThanOrEqual(99);
    }
  }
  expect(nightmare.overall).toBeGreaterThanOrEqual(25);
});

test("identical film → identical rating (deterministic, unlike a model)", () => {
  const film = [
    poss({ shot: "made", good_reads: 1 }),
    poss({ turnover: true }),
    poss({ shot: "missed", defense: "positive" }),
  ];
  expect(computeRating(film)).toEqual(computeRating(film));
});

test("evidence lines carry the receipts", () => {
  const r = computeRating([
    poss({ shot: "made" }),
    poss({ shot: "missed", turnover: true }),
    poss({ good_reads: 1 }),
  ]);
  expect(r.evidence.join(" ")).toContain("1/2 shooting");
  expect(r.evidence.join(" ")).toContain("1 turnover in 3 possessions");
});
