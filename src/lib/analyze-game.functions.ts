import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ gameId: z.string().uuid() });

/**
 * Analyze a game: calls Lovable AI Gateway (Gemini 2.5) to produce a
 * structured possession-by-possession breakdown. In this MVP the model is
 * prompted with the game's metadata (title, opponent, angle, duration) and
 * asked to produce a realistic, coaching-quality breakdown that is clearly
 * marked as AI-generated. True video ingestion requires the Google Files API
 * pipeline and is planned for v2.
 */
export const analyzeGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: game, error: gErr } = await supabase
      .from("games")
      .select("*")
      .eq("id", data.gameId)
      .eq("user_id", userId)
      .maybeSingle();

    if (gErr || !game) throw new Error("Game not found");

    await supabase.from("games").update({ status: "processing", error: null }).eq("id", game.id);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      await supabase.from("games").update({ status: "failed", error: "LOVABLE_API_KEY not configured" }).eq("id", game.id);
      throw new Error("AI is not configured on this server");
    }

    const durationSec = game.duration_seconds ?? 2400; // default ~40 min
    // Aim for ~1 possession per 20s of game clock, capped for MVP
    const targetPossessions = Math.min(30, Math.max(6, Math.floor(durationSec / 25)));

    const prompt = `You are PlayIQ, an expert basketball film analyst producing structured, coach-quality possession-by-possession breakdowns.

GAME METADATA (this is all you know — the raw video is not attached in this MVP path):
- Title: ${game.title}
- Opponent: ${game.opponent ?? "unknown"}
- Date: ${game.game_date ?? "unknown"}
- Camera angle: ${game.camera_angle}
- Estimated duration (seconds): ${durationSec}

Because you cannot see the video, generate a REPRESENTATIVE breakdown of ${targetPossessions} possessions that a coach could plausibly review. Vary offensive actions (pick-and-roll, horns, drag screen, DHO, isolation, transition, post-up, cut, off-ball screen), outcomes, and defensive scenarios. Use realistic clock progression across the game duration.

For EVERY possession:
- Be concrete and coach-specific (spacing, angles, timing, decision-making).
- Use LOW confidence generously — the model cannot actually see the video, so honest uncertainty is required. Never fabricate specific jersey numbers or names.
- Set flagged=true only for high-signal teaching moments (clear breakdowns, standout reads).
- Times must strictly increase and stay within 0..${durationSec}.

Return ONLY valid JSON matching this exact TypeScript type — no prose, no markdown:
{
  "possessions": Array<{
    "possession_index": number,
    "start_seconds": number,
    "end_seconds": number,
    "outcome": "made_shot"|"missed_shot"|"turnover"|"defensive_stop"|"defensive_breakdown"|"foul"|"other",
    "what_happened": string,
    "what_went_right": string,
    "what_went_wrong": string,
    "alternative": string,
    "confidence": "low"|"medium"|"high",
    "flagged": boolean
  }>
}`;

    let parsed: { possessions: Array<Record<string, unknown>> };
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You output only valid JSON conforming to the requested schema." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (res.status === 429) throw new Error("Rate limit reached — try again in a minute");
      if (res.status === 402) throw new Error("AI credits exhausted — top up Lovable AI to continue");
      if (!res.ok) throw new Error(`AI gateway error ${res.status}`);

      const json = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? "{}";
      parsed = JSON.parse(content);
      if (!Array.isArray(parsed?.possessions)) throw new Error("Malformed AI response");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI call failed";
      await supabase.from("games").update({ status: "failed", error: msg }).eq("id", game.id);
      throw new Error(msg);
    }

    // Clear old plays for idempotency, then insert
    await supabase.from("plays").delete().eq("game_id", game.id);

    const rows = parsed.possessions.slice(0, 40).map((p, i) => ({
      game_id: game.id,
      possession_index: Number(p.possession_index ?? i + 1),
      start_seconds: Number(p.start_seconds ?? i * 20),
      end_seconds: Number(p.end_seconds ?? i * 20 + 18),
      outcome: (p.outcome as string) || "other",
      what_happened: String(p.what_happened ?? ""),
      what_went_right: p.what_went_right ? String(p.what_went_right) : null,
      what_went_wrong: p.what_went_wrong ? String(p.what_went_wrong) : null,
      alternative: p.alternative ? String(p.alternative) : null,
      confidence: (p.confidence as string) || "low",
      flagged: Boolean(p.flagged),
    }));

    const { error: insErr } = await supabase.from("plays").insert(rows);
    if (insErr) {
      await supabase.from("games").update({ status: "failed", error: insErr.message }).eq("id", game.id);
      throw new Error(insErr.message);
    }

    await supabase.from("games").update({ status: "ready" }).eq("id", game.id);
    return { ok: true, count: rows.length };
  });
