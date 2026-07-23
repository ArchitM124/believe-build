import type { PlayerStats } from "./possession-analysis.core";

/**
 * The rating engine. The AI COUNTS events per possession (PlayerStats); this
 * module turns those counts into 2K-style numbers deterministically. The AI
 * never chooses a number — that's what keeps ratings consistent, honest, and
 * explainable ("Ball security 61 — 4 turnovers in 28 possessions").
 *
 * Two ideas make the number MEAN something:
 *
 * 1. CONFIDENCE / SAMPLE SIZE. Every sub-score starts at a neutral baseline
 *    (68, "Solid") and only earns its way to the extremes as evidence piles up.
 *    One made shot can't make you a 95; ten can. A rough 4-possession stretch
 *    can't crater you; a rough 40-possession game can. This is what stops tiny
 *    samples from producing wild, meaningless numbers.
 *
 * 2. A LADDER. The overall maps to a named tier (Rough → Elite) and the shape
 *    of the sub-scores names an archetype (Bucket Getter, Floor General, …).
 *    "74 — Standout · Bucket Getter" tells a story a bare "74" never could.
 *
 * FORM nudges, events drive. Grounded form buckets the AI observed (shooting
 * mechanics, dribble exposure, defensive stance, off-ball movement) adjust the
 * matching sub-score by a few points — gated by how often they were actually
 * seen — but the objective events (made/missed, turnover) stay the backbone.
 *
 * Scale: 25–99 like 2K. A sub-score is null when the film contains no evidence
 * for it (no shots taken → no scoring grade); the overall reweights around it.
 * This is a GAME/SESSION score — a grade of what's on this film. It sharpens as
 * more film is rated (more evidence → more confidence → the number can move).
 */

export type SubScores = {
  // Every skill facet is null when the film gave no chance to show it — a
  // non-shooter has null scoring, a player who never handled the ball has null
  // ball_security/playmaking/decision_making, a player who never defended on
  // camera has null defense. The overall reweights around whatever's present,
  // so a role player is graded on their role, not penalized for the rest.
  scoring: number | null;
  ball_security: number | null;
  playmaking: number | null;
  decision_making: number | null;
  defense: number | null;
  activity: number;
};

export type RatingResult = {
  overall: number;
  subScores: SubScores;
  evidence: string[];
  possessions: number;
  tier: string;
  archetype: string;
  /** True when there's too little countable film to trust the number — a
   *  low-involvement player. The UI shows it as a provisional read. */
  provisional: boolean;
};

export const MIN_POSSESSIONS = 3;

/** Where an unknown player sits until the film proves otherwise ("Solid"). */
const BASELINE = 68;
/** Smoothing constants: evidence / (evidence + K) is how far a score may leave
 *  the baseline. Bigger K = needs more evidence to reach the extremes. */
const K_POSS = 6; // per-possession categories (security, playmaking, decisions, activity)
const K_SHOT = 5; // scoring — measured over shot attempts
const K_DEF = 5; // defense — measured over defensive possessions
const K_FORM = 4; // form buckets — how much a form signal is trusted by count

const WEIGHTS: Record<keyof SubScores, number> = {
  scoring: 0.25,
  decision_making: 0.2,
  ball_security: 0.15,
  playmaking: 0.15,
  defense: 0.15,
  activity: 0.1,
};

const clamp = (v: number, lo = 25, hi = 99) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Pull a raw score toward the baseline based on how much evidence backs it. */
function calibrate(raw: number, evidence: number, k: number): number {
  const confidence = evidence / (evidence + k);
  return clamp(BASELINE + (raw - BASELINE) * confidence);
}

/** A bounded, count-gated nudge from a form signal in [-1, 1]. Leans light
 *  until enough observations exist to trust it — "form nudges, events drive". */
function formNudge(pos: number, neg: number, maxDelta: number): number {
  const seen = pos + neg;
  if (seen === 0) return 0;
  const signal = (pos - neg) / seen; // -1 … 1
  const trust = seen / (seen + K_FORM);
  return maxDelta * signal * trust;
}

const TIERS = [
  { label: "Rough", hi: 49 },
  { label: "Developing", hi: 64 },
  { label: "Solid", hi: 74 },
  { label: "Standout", hi: 84 },
  { label: "Dominant", hi: 92 },
  { label: "Elite", hi: 99 },
] as const;

/** Map an overall (25–99) to its named tier. */
export function ratingTier(overall: number): string {
  return (TIERS.find((t) => overall <= t.hi) ?? TIERS[TIERS.length - 1]).label;
}

/**
 * STYLE HINTS — HOW a player produces, read from the form tallies. These turn a
 * generic "Bucket Getter" into a "Sharpshooter" vs a "Cutter", etc. They're the
 * softest signal (form), so they only refine the label, never the number.
 */
export type ArchetypeHints = {
  usage: "high" | "medium" | "low";
  shooter: boolean; // makes come with clean jumpshot form
  cutter: boolean; // works off the ball
  lockdown: boolean; // sits low and slides on defense
};

const NEUTRAL_HINTS: ArchetypeHints = {
  usage: "medium",
  shooter: false,
  cutter: false,
  lockdown: false,
};

/**
 * Name the player's archetype from the SHAPE of the sub-scores plus optional
 * style hints — pure code, no AI, so it's free and consistent. These labels are
 * the shareable, braggable part; rename them here without touching any math.
 *
 * Priority: turnover-prone → no-real-strength → balanced → the top identity
 * facet (scoring / playmaking / defense), refined by how they produce.
 */
export function playerArchetype(sub: SubScores, hints: ArchetypeHints = NEUTRAL_HINTS): string {
  // Turnover-prone overrides everything — the loose-handle gambler.
  if (sub.ball_security !== null && sub.ball_security < 60) return "Gambler";

  // Rank only the IDENTITY facets. Decision-making and activity top out just for
  // avoiding mistakes / touching the ball, so they'd drown out what a player
  // actually IS — nobody's archetype is "Involved Guy".
  const IDENTITY: Array<keyof SubScores> = ["scoring", "playmaking", "defense"];
  const present = IDENTITY.map((k) => ({ k, v: sub[k] })).filter(
    (e): e is { k: keyof SubScores; v: number } => e.v !== null,
  );
  if (present.length === 0) return "All-Around";

  present.sort((a, b) => b.v - a.v);
  const top = present[0];
  const spread = top.v - present[present.length - 1].v;

  // No identity skill stands out at all — labeled by motor, not by skill.
  if (top.v < 62) {
    if (hints.lockdown) return "Pest"; // little offense, but a nuisance on D
    return hints.usage === "low" ? "Role Player" : "Motor";
  }

  // Multiple real strengths, none separating — a do-it-all.
  if (present.length > 1 && spread <= 5) {
    return hints.usage === "low" ? "Glue Guy" : "All-Around";
  }

  const goodD = sub.defense !== null && sub.defense >= 72;
  const scoresToo = sub.scoring !== null && sub.scoring >= 70;
  const playmakesToo = sub.playmaking !== null && sub.playmaking >= 70;

  switch (top.k) {
    case "scoring":
      if (goodD) return "Two-Way Wing";
      if (playmakesToo) return "Shot Creator"; // scores and sets up
      if (hints.shooter) return "Sharpshooter";
      if (hints.cutter) return "Cutter";
      return hints.usage === "low" ? "Microwave" : "Bucket Getter";
    case "playmaking":
      if (goodD) return "Two-Way Guard";
      if (scoresToo) return "Lead Guard";
      return hints.usage === "low" ? "Connector" : "Floor General";
    case "defense":
      if (scoresToo || playmakesToo) return "Two-Way Wing";
      if (hints.lockdown) return "Lockdown";
      return hints.usage === "low" ? "Anchor" : "Menace";
    default:
      return "All-Around";
  }
}

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

  // Form tallies (only possessions where the AI actually recorded the form fact).
  const cleanShots = stats.filter((s) => s.shot_mechanics === "clean").length;
  const flawShots = stats.filter((s) => s.shot_mechanics === "flaw").length;
  const lowHandle = stats.filter((s) => s.handle === "low_controlled").length;
  const highHandle = stats.filter((s) => s.handle === "high_exposed").length;
  const lowStance = stats.filter((s) => s.def_form === "low_slides").length;
  const highStance = stats.filter((s) => s.def_form === "upright_crosses").length;
  const activeOff = stats.filter((s) => s.off_ball === "active").length;
  const passiveOff = stats.filter((s) => s.off_ball === "passive").length;

  // "On-ball" possessions — where the player actually did something WITH the
  // ball. Offensive skills are judged over THESE, not diluted by their
  // defensive possessions, and go null when there aren't enough to judge fairly
  // (a role player who barely handled it isn't graded as a bad ball-handler).
  const onBall = stats.filter(
    (s) =>
      s.shot !== "none" ||
      s.turnover ||
      s.good_reads > 0 ||
      s.bad_decisions > 0 ||
      s.handle != null, // recorded dribble form = they were handling the ball
  ).length;
  const hasBallRole = onBall >= 2;

  // Raw rates (before confidence). Form nudges the raw where it applies. A facet
  // is null when the film gave no chance to show it — the overall reweights.
  // One attempt can't grade shooting (nor label someone a scorer) — need ≥2.
  const scoringRaw = shots < 2 ? null : 40 + 55 * (made / shots);
  const ballSecurityRaw = !hasBallRole ? null : 95 - 150 * (turnovers / onBall);
  const playmakingRaw = !hasBallRole ? null : 45 + 60 * (goodReads / onBall);
  const decisionRaw = !hasBallRole ? null : 95 - 140 * (badDecisions / onBall);
  const defenseRaw =
    defensivePoss.length === 0 ? null : 60 + 35 * ((dPos - dNeg) / defensivePoss.length);
  const activityRaw = 30 + 65 * (involved / n);

  // Sub-scores: calibrate the raw toward baseline by evidence, then apply the
  // bounded form nudge on top (so a form misread can't crater a real number).
  const subScores: SubScores = {
    scoring:
      scoringRaw === null
        ? null
        : clamp(calibrate(scoringRaw, shots, K_SHOT) + formNudge(cleanShots, flawShots, 6)),
    ball_security:
      ballSecurityRaw === null
        ? null
        : clamp(calibrate(ballSecurityRaw, onBall, K_POSS) + formNudge(lowHandle, highHandle, 8)),
    playmaking: playmakingRaw === null ? null : calibrate(playmakingRaw, onBall, K_POSS),
    decision_making: decisionRaw === null ? null : calibrate(decisionRaw, onBall, K_POSS),
    defense:
      defenseRaw === null
        ? null
        : clamp(
            calibrate(defenseRaw, defensivePoss.length, K_DEF) +
              formNudge(lowStance, highStance, 6),
          ),
    activity: clamp(calibrate(activityRaw, n, K_POSS) + formNudge(activeOff, passiveOff, 6)),
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

  // Form receipts — the differentiated eye-test detail, only when it was seen.
  if (flawShots > 0)
    evidence.push(`shooting form flagged on ${flawShots} of ${cleanShots + flawShots} jumpers`);
  else if (cleanShots > 0)
    evidence.push(`clean shooting form (${cleanShots} jumper${cleanShots === 1 ? "" : "s"})`);
  if (lowHandle + highHandle > 0)
    evidence.push(
      highHandle >= lowHandle
        ? `high, exposed handle on ${highHandle} of ${lowHandle + highHandle} possessions`
        : `low, controlled handle on ${lowHandle} of ${lowHandle + highHandle} possessions`,
    );
  if (lowStance + highStance > 0)
    evidence.push(
      lowStance >= highStance
        ? `sits low and slides on defense (${lowStance} possession${lowStance === 1 ? "" : "s"})`
        : `upright, crosses feet on defense (${highStance} possession${highStance === 1 ? "" : "s"})`,
    );
  if (activeOff + passiveOff > 0)
    evidence.push(
      activeOff >= passiveOff
        ? `active off the ball (${activeOff} possession${activeOff === 1 ? "" : "s"})`
        : `drifts / ball-watches off the ball (${passiveOff} possession${passiveOff === 1 ? "" : "s"})`,
    );

  // Style hints for the archetype — HOW they produced, from usage and form.
  const touches = involved / n;
  const usage: ArchetypeHints["usage"] =
    touches <= 0.5
      ? "low"
      : touches >= 0.8 && (shots / n >= 0.35 || goodReads / n >= 0.5 || turnovers / n >= 0.25)
        ? "high"
        : "medium";
  const hints: ArchetypeHints = {
    usage,
    shooter: cleanShots >= 2 && cleanShots > flawShots,
    cutter: activeOff >= 2 && activeOff > passiveOff,
    lockdown: lowStance >= 2 && lowStance > highStance,
  };

  // Provisional when there's just too little countable film to trust the number
  // — a genuinely low-involvement player. Measured purely in real events
  // (on-ball + defensive possessions): a pure defender with lots of D film is
  // NOT provisional even though only one facet is gradeable.
  const provisional = onBall + defensivePoss.length < 4;

  return {
    overall,
    subScores,
    evidence,
    possessions: n,
    tier: ratingTier(overall),
    archetype: playerArchetype(subScores, hints),
    provisional,
  };
}
