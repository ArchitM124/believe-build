import { test, expect } from "bun:test";
import { computeRating, MIN_POSSESSIONS, ratingTier, playerArchetype } from "./player-rating";
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

const rep = (n: number, over: Partial<PlayerStats> = {}) =>
  Array.from({ length: n }, () => poss(over));

test("refuses to rate with fewer than MIN_POSSESSIONS", () => {
  expect(() => computeRating([poss(), poss()])).toThrow(String(MIN_POSSESSIONS));
});

test("a small great session lands Standout — good, not extreme; a small rough one lands Developing", () => {
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
  // Four possessions can't mint a 90 or a 30 — the sample is too thin to be sure.
  expect(great.overall).toBeGreaterThan(74);
  expect(great.overall).toBeLessThanOrEqual(84);
  expect(rough.overall).toBeGreaterThanOrEqual(50);
  expect(rough.overall).toBeLessThan(65);
  expect(great.overall).toBeGreaterThan(rough.overall);
});

test("VOLUME MOVES THE NUMBER: the same play, more possessions, reaches further from baseline", () => {
  const greatUnit = { shot: "made", good_reads: 1 } as const;
  const roughUnit = { turnover: true, bad_decisions: 2 } as const;

  const great4 = computeRating(rep(4, greatUnit)).overall;
  const great16 = computeRating(rep(16, greatUnit)).overall;
  const rough4 = computeRating(rep(4, roughUnit)).overall;
  const rough16 = computeRating(rep(16, roughUnit)).overall;

  // More evidence of the SAME quality pushes the score harder in that direction.
  expect(great16).toBeGreaterThan(great4);
  expect(rough16).toBeLessThan(rough4);
  // A big sample can actually reach the tiers a tiny one can't.
  expect(great16).toBeGreaterThanOrEqual(85); // Dominant is now reachable
  expect(rough16).toBeLessThanOrEqual(55);
});

test("an unknown player with clean-but-empty film sits in the Solid baseline", () => {
  const r = computeRating(rep(3)); // involved, but nothing else recorded
  expect(r.overall).toBeGreaterThanOrEqual(65);
  expect(r.overall).toBeLessThanOrEqual(74);
  expect(r.tier).toBe("Solid");
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

test("a big, uniformly awful sample craters but stays clamped to 25–99", () => {
  const nightmare = computeRating(
    rep(20, {
      shot: "missed",
      turnover: true,
      bad_decisions: 3,
      defense: "negative",
      involved: false,
    }),
  );
  for (const v of Object.values(nightmare.subScores)) {
    if (v !== null) {
      expect(v).toBeGreaterThanOrEqual(25);
      expect(v).toBeLessThanOrEqual(99);
    }
  }
  expect(nightmare.overall).toBeGreaterThanOrEqual(25);
  expect(nightmare.overall).toBeLessThan(50);
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

// ---- FORM: nudges the matching sub-score, never drives it -----------------

test("clean shooting form lifts scoring; a flaw tempers it — but only by a nudge", () => {
  const clean = computeRating(rep(6, { shot: "made", shot_mechanics: "clean" }));
  const flaw = computeRating(rep(6, { shot: "made", shot_mechanics: "flaw" }));
  expect(clean.subScores.scoring! > flaw.subScores.scoring!).toBe(true);
  // Same makes, same volume — form only moves it a few points, it can't dominate.
  expect(clean.subScores.scoring! - flaw.subScores.scoring!).toBeLessThanOrEqual(14);
  expect(flaw.evidence.join(" ")).toContain("shooting form flagged");
  expect(clean.evidence.join(" ")).toContain("clean shooting form");
});

test("a high, exposed handle lowers ball security vs a low, controlled one", () => {
  const low = computeRating(rep(8, { handle: "low_controlled" }));
  const high = computeRating(rep(8, { handle: "high_exposed" }));
  expect(low.subScores.ball_security > high.subScores.ball_security).toBe(true);
  expect(high.evidence.join(" ")).toContain("high, exposed handle");
});

test("defensive stance and off-ball movement surface as receipts", () => {
  const r = computeRating(
    rep(5, { def_form: "low_slides", off_ball: "active", defense: "positive" }),
  );
  expect(r.evidence.join(" ")).toContain("sits low and slides");
  expect(r.evidence.join(" ")).toContain("active off the ball");
});

// ---- The ladder: tiers and archetypes -------------------------------------

test("ratingTier maps the whole 25–99 range to named tiers", () => {
  expect(ratingTier(25)).toBe("Rough");
  expect(ratingTier(49)).toBe("Rough");
  expect(ratingTier(50)).toBe("Developing");
  expect(ratingTier(64)).toBe("Developing");
  expect(ratingTier(65)).toBe("Solid");
  expect(ratingTier(74)).toBe("Solid");
  expect(ratingTier(75)).toBe("Standout");
  expect(ratingTier(84)).toBe("Standout");
  expect(ratingTier(85)).toBe("Dominant");
  expect(ratingTier(92)).toBe("Dominant");
  expect(ratingTier(93)).toBe("Elite");
  expect(ratingTier(99)).toBe("Elite");
});

test("playerArchetype names the shape of the sub-scores", () => {
  expect(
    playerArchetype({
      scoring: 88,
      ball_security: 70,
      playmaking: 60,
      decision_making: 72,
      defense: null,
      activity: 75,
    }),
  ).toBe("Bucket Getter");
  // Same shape but real defense → two-way.
  expect(
    playerArchetype({
      scoring: 88,
      ball_security: 70,
      playmaking: 60,
      decision_making: 72,
      defense: 80,
      activity: 75,
    }),
  ).toBe("Two-Way Wing");
  expect(
    playerArchetype({
      scoring: 60,
      ball_security: 75,
      playmaking: 90,
      decision_making: 80,
      defense: null,
      activity: 78,
    }),
  ).toBe("Floor General");
  // Low ball security overrides everything — the loose-handle gambler.
  expect(
    playerArchetype({
      scoring: 70,
      ball_security: 50,
      playmaking: 80,
      decision_making: 65,
      defense: null,
      activity: 75,
    }),
  ).toBe("Gambler");
  // No real separation between facets → all-around.
  expect(
    playerArchetype({
      scoring: 72,
      ball_security: 74,
      playmaking: 71,
      decision_making: 73,
      defense: null,
      activity: 70,
    }),
  ).toBe("All-Around");
  expect(
    playerArchetype({
      scoring: 60,
      ball_security: 70,
      playmaking: 65,
      decision_making: 68,
      defense: 85,
      activity: 80,
    }),
  ).toBe("Menace");
});

test("computeRating result carries a tier and archetype consistent with the overall", () => {
  const r = computeRating([
    poss({ shot: "made", good_reads: 1 }),
    poss({ shot: "made" }),
    poss({ good_reads: 2 }),
  ]);
  expect(r.tier).toBe(ratingTier(r.overall));
  expect(typeof r.archetype).toBe("string");
  expect(r.archetype.length).toBeGreaterThan(0);
});
