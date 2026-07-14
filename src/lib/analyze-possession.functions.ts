import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runPossessionAnalysis, isOutcome } from "@/lib/possession-analysis.core";
import { STALE_AFTER_MS } from "@/lib/analysis-constants";

const InputSchema = z.object({ possessionId: z.string().uuid() });

// Gemini caps the TOTAL inline request at 20 MB, and base64 inflates the raw
// bytes by ~33%. Gate raw bytes at 14 MB so the encoded payload (~18.7 MB plus
// prompt) stays safely under that ceiling.
const MAX_VIDEO_BYTES = 14 * 1024 * 1024;

/**
 * Analyze a single possession clip. The heavy lifting — a two-pass
 * observe-then-judge pipeline against Gemini 2.5 Pro — lives in
 * possession-analysis.core.ts so it can also run in the offline eval harness.
 * This function just handles auth, pulling the video bytes, and persistence.
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

    // Concurrency guard: if this possession is already being analyzed and was
    // touched more recently than the stale window, another run owns it — don't
    // start a duplicate (would double-spend AI credits and let a slow/failed
    // duplicate overwrite a good result). A genuinely stuck run (updated_at
    // older than the window) is allowed to be taken over.
    if (
      play.status === "processing" &&
      Date.now() - new Date(play.updated_at).getTime() < STALE_AFTER_MS
    ) {
      return { ok: true, skipped: true };
    }

    await supabase.from("plays").update({ status: "processing", error: null }).eq("id", play.id);

    // Provider selection: a GEMINI_API_KEY (your own Google key, direct API,
    // Gemini 2.5 Pro) takes priority; otherwise fall back to the Lovable
    // gateway. AI_MODEL overrides the per-provider default model.
    const geminiKey = process.env.GEMINI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    const provider = geminiKey ? ("gemini" as const) : ("lovable" as const);
    const apiKey = geminiKey ?? lovableKey;
    if (!apiKey) {
      await supabase
        .from("plays")
        .update({
          status: "failed",
          error: "No AI key configured (set GEMINI_API_KEY or LOVABLE_API_KEY)",
        })
        .eq("id", play.id);
      throw new Error("AI is not configured on this server");
    }

    // --- 1) Pull the actual video bytes via a short-lived signed URL ---
    let videoDataUrl: string;
    let mimeType = "video/mp4";
    let sizeMB = 0;
    try {
      const { data: signed, error: sErr } = await supabase.storage
        .from("game-videos")
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
          `Clip is ${sizeMB.toFixed(1)} MB. For accurate AI analysis, please trim to a single possession under 20 MB (usually ≤15 seconds at 1080p, or ≤30s at 720p).`,
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

    // --- 2) Run the two-pass analysis ---
    let result;
    try {
      result = await runPossessionAnalysis({
        videoDataUrl,
        apiKey,
        provider,
        model: process.env.AI_MODEL || undefined,
        context: {
          role: play.uploader_role ?? "coach",
          title: play.title,
          notes: play.notes,
          teamColor: play.team_color,
          attackDirection: play.attack_direction,
          durationSec: play.duration_seconds ?? 0,
          trackedPlayer: play.tracked_player,
          declaredOutcome: play.declared_outcome,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI call failed";
      await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
      throw new Error(msg);
    }

    // --- 3) Persist (core already validated/clamped outcome & confidence) ---
    const { error: uErr } = await supabase
      .from("plays")
      .update({
        // A user-declared result is ground truth — it wins over the model's
        // classification regardless of what the judge returned.
        outcome: isOutcome(play.declared_outcome) ? play.declared_outcome : result.outcome,
        confidence: result.confidence,
        what_happened: result.what_happened,
        what_went_right: result.what_went_right || null,
        what_went_wrong: result.what_went_wrong || null,
        alternative: result.alternative || null,
        player_stats: result.player_stats,
        flagged: result.flagged,
        start_seconds: 0,
        end_seconds: play.duration_seconds ?? 0,
        status: "ready",
      })
      .eq("id", play.id);

    if (uErr) {
      await supabase
        .from("plays")
        .update({ status: "failed", error: uErr.message })
        .eq("id", play.id);
      throw new Error(uErr.message);
    }

    return { ok: true };
  });
