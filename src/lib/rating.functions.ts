import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateStructuredJson,
  parseModelJson,
  normalizePlayerStats,
  resolveModelConfig,
  type PlayerStats,
} from "@/lib/possession-analysis.core";
import { computeRating, MIN_POSSESSIONS } from "@/lib/player-rating";
import type { Json } from "@/integrations/supabase/types";

const InputSchema = z.object({
  playIds: z.array(z.string().uuid()).min(MIN_POSSESSIONS).max(100),
});

export type ScoutingReport = {
  headline: string;
  strengths: string[];
  weaknesses: string[];
  improve: string[];
};

const REPORT_SYSTEM = `You are PlayIQ's scouting-report writer. You receive FINAL computed ratings and counted evidence from one player's session of film. The numbers are already decided — you NEVER change, re-grade, or second-guess them. Write like a 2K-style scout: direct, specific, zero flattery, zero filler. Every claim must trace to the provided counts/evidence — do not invent events that aren't in the data. If the evidence is thin in an area, say so rather than padding. Jersey colors describe clothing, never people: write "the player in white" or "#23 in black" — NEVER "the white player" or "the black player" (reads as race). ADDRESS THE PLAYER DIRECTLY in second person for strengths, weaknesses, and improve: "You protected the ball — 0 turnovers in 12 possessions", "You need to..." — never "the player" or "they". The headline stays an identity line (no "you").`;

function reportUser(params: {
  trackedPlayer: string;
  possessions: number;
  overall: number;
  subScores: Record<string, number | null>;
  evidence: string[];
}): string {
  return `Player: ${params.trackedPlayer}
Film: ${params.possessions} analyzed possessions
OVERALL (final): ${params.overall}
Sub-scores (final): ${JSON.stringify(params.subScores)}
Counted evidence: ${params.evidence.join("; ")}

Return ONLY valid JSON — no prose, no markdown fences:
{
  "headline": string,      // one line, <=60 chars, the player's identity on this film (e.g. "High-motor slasher who forces the issue")
  "strengths": string[],   // 2-3 items, each citing the evidence/counts
  "weaknesses": string[],  // 2-3 items, each citing the evidence/counts
  "improve": string[]      // 2-3 concrete drills/habits that target the weaknesses
}`;
}

/**
 * Compute a 2K-style rating over a set of the caller's analyzed possessions.
 * Code computes every number from per-possession counted stats; one text-only
 * AI call writes the scouting report around the final numbers.
 */
export const generatePlayerRating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("plays")
      .select("id,tracked_player,player_stats,status")
      .in("id", data.playIds)
      .eq("user_id", userId)
      .eq("status", "ready")
      .not("tracked_player", "is", null)
      .not("player_stats", "is", null);
    if (error) throw new Error(error.message);

    const usable = (rows ?? [])
      .map((r) => ({
        id: r.id,
        tracked: r.tracked_player as string,
        stats: normalizePlayerStats(
          r.player_stats as NonNullable<Parameters<typeof normalizePlayerStats>[0]>,
        ),
      }))
      .filter((r): r is typeof r & { stats: PlayerStats } => r.stats !== null);

    if (usable.length < MIN_POSSESSIONS) {
      throw new Error(
        `Need at least ${MIN_POSSESSIONS} analyzed possessions with a focused player (found ${usable.length}). Upload clips with "Focus on one player" filled in.`,
      );
    }

    const rating = computeRating(usable.map((r) => r.stats));
    // The most common description among the selected clips names the player.
    const counts = new Map<string, number>();
    for (const r of usable) counts.set(r.tracked, (counts.get(r.tracked) ?? 0) + 1);
    const trackedPlayer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const config = resolveModelConfig(process.env);
    if (!config) throw new Error("AI is not configured on this server");

    let report: ScoutingReport;
    try {
      const raw = await generateStructuredJson({
        config,
        system: REPORT_SYSTEM,
        user: reportUser({
          trackedPlayer,
          possessions: rating.possessions,
          overall: rating.overall,
          subScores: rating.subScores,
          evidence: rating.evidence,
        }),
      });
      const parsed = parseModelJson<Partial<ScoutingReport>>(raw);
      const clean = (a: unknown) =>
        Array.isArray(a) ? a.slice(0, 3).map((s) => String(s).slice(0, 300)) : [];
      report = {
        headline: String(parsed.headline ?? "").slice(0, 80),
        strengths: clean(parsed.strengths),
        weaknesses: clean(parsed.weaknesses),
        improve: clean(parsed.improve),
      };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Report generation failed");
    }

    const { data: saved, error: iErr } = await supabase
      .from("ratings")
      .insert({
        user_id: userId,
        tracked_player: trackedPlayer,
        play_ids: usable.map((r) => r.id),
        possessions_used: rating.possessions,
        sub_scores: rating.subScores as unknown as Json,
        overall: rating.overall,
        report: { ...report, evidence: rating.evidence } as unknown as Json,
      })
      .select()
      .single();
    if (iErr || !saved) throw new Error(iErr?.message ?? "Could not save rating");

    return { id: saved.id, overall: rating.overall };
  });
