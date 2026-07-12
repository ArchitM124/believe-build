import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ possessionId: z.string().uuid() });

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB inline cap for Gemini

/**
 * Analyze a single possession clip by sending the actual video pixels to
 * Gemini 2.5 Pro (multimodal). The uploader's notes/title are provided as
 * context, but the model watches the clip and must ground every claim in
 * what it actually sees.
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
    if (!play.video_path) throw new Error("No video attached to this possession");

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

    // --- 1) Pull the actual video bytes via a short-lived signed URL ---
    let videoDataUrl: string;
    let mimeType = "video/mp4";
    let sizeMB = 0;
    try {
      const { data: signed, error: sErr } = await supabase
        .storage.from("game-videos")
        .createSignedUrl(play.video_path, 60 * 5);
      if (sErr || !signed?.signedUrl) throw new Error(sErr?.message ?? "Could not sign video URL");

      const vidRes = await fetch(signed.signedUrl);
      if (!vidRes.ok) throw new Error(`Video download failed: ${vidRes.status}`);

      const ct = vidRes.headers.get("content-type");
      if (ct && ct.startsWith("video/")) mimeType = ct.split(";")[0];

      const buf = new Uint8Array(await vidRes.arrayBuffer());
      sizeMB = buf.byteLength / (1024 * 1024);
      if (buf.byteLength > MAX_VIDEO_BYTES) {
        throw new Error(
          `Clip is ${sizeMB.toFixed(1)} MB. For accurate AI analysis, please trim to a single possession under 20 MB (usually ≤15 seconds at 1080p, or ≤30s at 720p).`
        );
      }

      // Base64 encode in chunks (avoid stack overflow on large arrays)
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const b64 = btoa(bin);
      videoDataUrl = `data:${mimeType};base64,${b64}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load video";
      await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
      throw new Error(msg);
    }

    const durationSec = play.duration_seconds ?? 0;
    const role = play.uploader_role ?? "coach";

    const systemPrompt = `You are PlayIQ, an elite basketball film-study analyst (NBA-caliber). You are WATCHING the attached video clip of ONE possession. Every claim you make MUST be grounded in what is visibly happening on screen — jersey colors, floor position, ball movement, defender positioning, timing. Do NOT hedge with generic basketball platitudes.

Hard rules:
- Reference concrete visual evidence: strong-side vs weak-side, high post vs elbow vs wing vs corner, ball-screen angle, help-side rotation, closeout distance, hand position, footwork.
- If it's a turnover, name the CAUSE with specificity: "live-ball turnover on a cross-court skip pass into weak-side help — the low-man dug in and tipped it" — NOT "miscommunication or poor pass".
- If you cannot tell something, say "unclear on video" instead of guessing.
- Use jersey COLORS (e.g. "the ball-handler in white") never invented names or numbers.
- Keep every field to 1–3 tight sentences. No filler, no restating the question.`;

    const userInstruction = `Break down this single possession.

Context from uploader (${role}):
- Title: ${play.title ?? "(none)"}
- Notes: ${play.notes ?? "(none)"}
- Duration: ~${durationSec}s

Return ONLY valid JSON matching this exact TypeScript type — no prose, no markdown fences:
{
  "outcome": "made_shot"|"missed_shot"|"turnover"|"defensive_stop"|"defensive_breakdown"|"foul"|"other",
  "what_happened": string,     // Specific play-by-play of what you SEE. Include set/action if identifiable (e.g. "horns ball-screen", "pin-down into DHO", "iso from the left wing").
  "what_went_right": string,   // Specific decisions/reads that were correct. "" if nothing notable.
  "what_went_wrong": string,   // The exact breakdown — WHO, WHERE on the floor, WHAT they did wrong, and WHY it caused the outcome. "" if nothing notable.
  "alternative": string,       // The specific better read: which pass, which counter, which footwork, which coverage.
  "confidence": "low"|"medium"|"high",  // "high" only if the video is clear enough to be certain.
  "flagged": boolean           // true if this clip is a strong teaching moment worth revisiting.
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
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userInstruction },
                { type: "file", file: { filename: "possession.mp4", file_data: videoDataUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (res.status === 429) throw new Error("Rate limit reached — try again in a minute");
      if (res.status === 402) throw new Error("AI credits exhausted — top up Lovable AI to continue");
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`AI gateway error ${res.status}: ${errText.slice(0, 200)}`);
      }

      const json = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? "{}";
      // Strip accidental markdown fences
      const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      parsed = JSON.parse(cleaned) as AiResp;
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
