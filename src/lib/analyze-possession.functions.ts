import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ possessionId: z.string().uuid() });

/**
 * Analyze a single possession clip.
 *
 * MVP note: the Lovable AI Gateway chat endpoint does not accept raw video
 * URLs, so this pass prompts Gemini 2.5 Flash with the possession metadata
 * (title, notes, duration, uploader role) and asks for a structured, coaching
 * breakdown. Real video ingestion (Google Files API) will slot in here later.
 */
export const analyzePossession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: play, error: pErr } = await supabase
      .from("plays")
      .select("*")
      .eq("id", data.possessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr || !play) throw new Error("Possession not found");

    await supabase
      .from("plays")
      .update({ status: "processing", error: null })
      .eq("id", play.id);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      await supabase
        .from("plays")
        .update({ status: "failed", error: "LOVABLE_API_KEY not configured" })
        .eq("id", play.id);
      throw new Error("AI is not configured on this server");
    }

    const durationSec = play.duration_seconds ?? 20;
    const role = play.uploader_role ?? "coach";

    const prompt = `You are PlayIQ, an expert basketball film analyst. A ${role} uploaded ONE possession clip and wants a concise, honest breakdown.

CLIP METADATA (the raw video is not attached in this MVP path):
- Title: ${play.title ?? "Untitled possession"}
- Uploader role: ${role}
- Duration (seconds): ${durationSec}
- Uploader notes: ${play.notes ?? "(none)"}

Because you cannot actually see the video, produce a plausible, coaching-quality breakdown grounded in the uploader's notes. If the notes are thin, keep confidence LOW and describe the most likely read given the metadata. Never invent jersey numbers or names.

Return ONLY valid JSON matching this exact TypeScript type — no prose, no markdown:
{
  "outcome": "made_shot"|"missed_shot"|"turnover"|"defensive_stop"|"defensive_breakdown"|"foul"|"other",
  "what_happened": string,     // 1-2 sentences, concrete and coach-specific
  "what_went_right": string,   // 1-2 sentences; "" if nothing notable
  "what_went_wrong": string,   // 1-2 sentences; "" if nothing notable
  "alternative": string,       // 1-2 sentences of a better read / next-time coaching cue
  "confidence": "low"|"medium"|"high",
  "flagged": boolean           // true only if this is a strong teaching moment
}`;

    type AiResp = {
      outcome?: string;
      what_happened?: string;
      what_went_right?: string;
      what_went_wrong?: string;
      alternative?: string;
      confidence?: string;
      flagged?: boolean;
    };

    let parsed: AiResp;
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
      parsed = JSON.parse(content) as AiResp;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI call failed";
      await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
      throw new Error(msg);
    }

    const outcomes = new Set(["made_shot", "missed_shot", "turnover", "defensive_stop", "defensive_breakdown", "foul", "other"]);
    const confs = new Set(["low", "medium", "high"]);
    const rawOut = String(parsed.outcome ?? "other");
    const rawConf = String(parsed.confidence ?? "low");

    const { error: uErr } = await supabase
      .from("plays")
      .update({
        outcome: (outcomes.has(rawOut) ? rawOut : "other") as
          | "made_shot" | "missed_shot" | "turnover" | "defensive_stop"
          | "defensive_breakdown" | "foul" | "other",
        confidence: (confs.has(rawConf) ? rawConf : "low") as "low" | "medium" | "high",
        what_happened: String(parsed.what_happened ?? "").slice(0, 2000),
        what_went_right: parsed.what_went_right ? String(parsed.what_went_right).slice(0, 2000) : null,
        what_went_wrong: parsed.what_went_wrong ? String(parsed.what_went_wrong).slice(0, 2000) : null,
        alternative: parsed.alternative ? String(parsed.alternative).slice(0, 2000) : null,
        flagged: Boolean(parsed.flagged),
        start_seconds: 0,
        end_seconds: durationSec,
        status: "ready",
      })
      .eq("id", play.id);

    if (uErr) {
      await supabase.from("plays").update({ status: "failed", error: uErr.message }).eq("id", play.id);
      throw new Error(uErr.message);
    }

    return { ok: true };
  });
