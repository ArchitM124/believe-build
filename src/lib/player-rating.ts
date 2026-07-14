import type { PlayerStats } from "./possession-analysis.core";

/**
 * The rating engine. The AI COUNTS events per possession (PlayerStats); this
 * module turns those counts into 2K-style numbers deterministically. The AI
 * never chooses a number — that's what keeps ratings consistent, honest, and
 * explainable ("Ball security 61 — 4 turnovers in 28 possessions").
 *
 * Scale: 25–99 like 2K. A sub-score is null when the film contains no evidence
 * for it (no shots taken → no scoring grade); the overall reweights around it.
 *
 * This is a GAME/SESSION score — a grade of what's on this film, not a claim
 * about overall ability. It stabilizes as more film is rated.
 */

export type SubScores = {
  scoring: number | null;
  ball_security: number;
  playmaking: number;
  decision_making: number;
  defense: number | null;
  activity: number;
};

export type RatingResult = {
  overall: number;
  subScores: SubScores;
  evidence: string[];
  possessions: number;
};

export const MIN_POSSESSIONS = 3;

const WEIGHTS: Record<keyof SubScores, number> = {
  scoring: 0.25,
  decision_making: 0.2,
  ball_security: 0.15,
  playmaking: 0.15,
  defense: 0.15,
  activity: 0.1,
};

const clamp = (v: number, lo = 25, hi = 99) => Math.min(hi, Math.max(lo, Math.round(v)));

export function computeRating(stats: PlayerStats[]): RatingResult {
  const n = stats.length;
  if (n < MIN_POSSESSIONS) {
    throw new Error(
      `Need at least ${MIN_POSSESSIONS} analyzed possessions with player stats to rate (got ${n}).`,
    );
  }

  const made = stats.filter((s) => s.shot === "made").length;
  const missed = stats.filter((s) => s.shot === "missed").length;
  const shots = made + missed;
  const turnovers = stats.filter((s) => s.turnover).length;
  const goodReads = stats.reduce((a, s) => a + s.good_reads, 0);
  const badDecisions = stats.reduce((a, s) => a + s.bad_decisions, 0);
  const defensivePoss = stats.filter((s) => s.defense !== "na");
  const dPos = defensivePoss.filter((s) => s.defense === "positive").length;
  const dNeg = defensivePoss.filter((s) => s.defense === "negative").length;
  const involved = stats.filter((s) => s.involved).length;

  const subScores: SubScores = {
    // 0% shooting → 40, 100% → 95. No shots → no grade.
    scoring: shots === 0 ? null : clamp(40 + 55 * (made / shots)),
    // 0 turnovers → 95; one every 5 possessions → 65; heavy → floor.
    ball_security: clamp(95 - 150 * (turnovers / n)),
    // Rewards good reads per possession; ~1 per possession → elite.
    playmaking: clamp(45 + 60 * (goodReads / n)),
    // Penalizes clear mistakes per possession.
    decision_making: clamp(95 - 140 * (badDecisions / n)),
    // Net positive vs negative defensive possessions. No D film → no grade.
    defense:
      defensivePoss.length === 0 ? null : clamp(60 + 35 * ((dPos - dNeg) / defensivePoss.length)),
    // How often they meaningfully participate.
    activity: clamp(30 + 65 * (involved / n)),
  };

  // Weighted mean over the sub-scores that have evidence.
  let weightSum = 0;
  let acc = 0;
  for (const key of Object.keys(WEIGHTS) as Array<keyof SubScores>) {
    const score = subScores[key];
    if (score === null) continue;
    acc += score * WEIGHTS[key];
    weightSum += WEIGHTS[key];
  }
  const overall = clamp(acc / weightSum);

  const evidence = [
    shots > 0 ? `${made}/${shots} shooting on film` : "no shot attempts on film",
    `${turnovers} turnover${turnovers === 1 ? "" : "s"} in ${n} possessions`,
    `${goodReads} good read${goodReads === 1 ? "" : "s"}, ${badDecisions} questionable decision${badDecisions === 1 ? "" : "s"}`,
    defensivePoss.length > 0
      ? `${dPos} positive / ${dNeg} negative defensive possessions (of ${defensivePoss.length})`
      : "no defensive possessions on film",
    `involved in ${involved} of ${n} possessions`,
  ];

  return { overall, subScores, evidence, possessions: n };
}
