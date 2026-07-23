import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runPossessionAnalysis,
  runJumpshotAnalysis,
  runGameRating,
  uploadGeminiFile,
  resolveModelConfig,
  resolveProviderConfig,
  isOutcome,
  type ModelConfig,
  type Provider,
} from "@/lib/possession-analysis.core";
import { STALE_AFTER_MS } from "@/lib/analysis-constants";

const InputSchema = z.object({ possessionId: z.string().uuid() });

// Gemini caps the TOTAL inline request at 20 MB, and base64 inflates the raw
// bytes by ~33%. Gate raw bytes at 14 MB so the encoded payload (~18.7 MB plus
// prompt) stays safely under that ceiling.
const MAX_VIDEO_BYTES = 14 * 1024 * 1024;
// Full games go through the Files API (no inline ceiling), but we still hold the
// bytes in memory to upload them, so cap at a sane size. ~300 MB comfortably
// covers a 15-20 min run at phone-friendly resolution.
const GAME_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Analyze one upload. Possessions and jumpshots run the two-pass observe→judge
 * pipeline against a short clip; full games are uploaded whole via the Gemini
 * Files API and tallied into per-possession stats for the rating. The heavy
 * lifting lives in possession-analysis.core.ts so it can also run in the eval
 * harness. This function handles auth, video bytes, and persistence.
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

    const isGame = play.kind === "game";

    // Concurrency guard: if this row is already being analyzed and was touched
    // more recently than the stale window, another run owns it — don't start a
    // duplicate (double-spends AI credits; a slow/failed duplicate could
    // overwrite a good result). A genuinely stuck run (older than the window)
    // is allowed to be taken over.
    if (
      play.status === "processing" &&
      Date.now() - new Date(play.updated_at).getTime() < STALE_AFTER_MS
    ) {
      return { ok: true, skipped: true };
    }

    await supabase.from("plays").update({ status: "processing", error: null }).eq("id", play.id);

    // Provider selection: AI_PROVIDER forces one; otherwise the first configured
    // key wins (gemini → perceptron → qwen → lovable). AI_MODEL overrides model.
    let modelConfig;
    try {
      modelConfig = resolveModelConfig(process.env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI provider misconfigured";
      await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
      throw new Error(msg);
    }
    if (!modelConfig) {
      await supabase
        .from("plays")
        .update({
          status: "failed",
          error:
            "No AI key configured (set GEMINI_API_KEY, PERCEPTRON_API_KEY, QWEN_API_KEY, or LOVABLE_API_KEY)",
        })
        .eq("id", play.id);
      throw new Error("AI is not configured on this server");
    }

    // Full-game tally needs the Gemini Files API (long video) and a player to
    // rate. If either is missing, save the game with guidance instead of failing
    // — it still counts toward unlocking the hidden overall, and clips work.
    if (isGame && (modelConfig.provider !== "gemini" || !play.tracked_player?.trim())) {
      await supabase
        .from("plays")
        .update({
          status: "ready",
          what_happened:
            modelConfig.provider !== "gemini"
              ? "Full game saved. Whole-game breakdown needs the Gemini AI key — for now, clip your key possessions and upload them for analysis."
              : "Full game saved. To get a rating from it, re-upload with 'Focus on one player' filled in so the AI knows who to track. You can also clip key possessions.",
        })
        .eq("id", play.id);
      return { ok: true };
    }

    // --- 1) Pull the video bytes via a short-lived signed URL ---
    let buf: Uint8Array;
    let mimeType = "video/mp4";
    let videoRemoteUrl: string | undefined;
    try {
      const { data: signed, error: sErr } = await supabase.storage
        .from("game-videos")
        .createSignedUrl(play.video_path, 60 * 5);
      if (sErr || !signed?.signedUrl) throw new Error(sErr?.message ?? "Could not sign video URL");
      videoRemoteUrl = signed.signedUrl;

      const vidRes = await fetch(signed.signedUrl);
      if (!vidRes.ok) throw new Error(`Video download failed: ${vidRes.status}`);
      const ct = vidRes.headers.get("content-type");
      if (ct && ct.startsWith("video/")) mimeType = ct.split(";")[0];

      buf = new Uint8Array(await vidRes.arrayBuffer());
      const cap = isGame ? GAME_MAX_BYTES : MAX_VIDEO_BYTES;
      if (buf.byteLength > cap) {
        const sizeMB = buf.byteLength / (1024 * 1024);
        throw new Error(
          isGame
            ? `Game is ${sizeMB.toFixed(0)} MB — please keep games under ${GAME_MAX_BYTES / (1024 * 1024)} MB (record at 720p, or upload a single run).`
            : `Clip is ${sizeMB.toFixed(1)} MB. For accurate AI analysis, please trim to a single possession under 20 MB (usually ≤15 seconds at 1080p, or ≤30s at 720p).`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load video";
      await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
      throw new Error(msg);
    }

    // --- 2a) FULL GAME: upload whole video, tally the player's possessions ---
    if (isGame) {
      try {
        const uploaded = await uploadGeminiFile({
          apiKey: modelConfig.apiKey,
          bytes: buf,
          mimeType,
          displayName: play.title ?? "game",
        });
        const game = await runGameRating({
          fileUri: uploaded.fileUri,
          mimeType: uploaded.mimeType,
          apiKey: modelConfig.apiKey,
          model: modelConfig.model,
          fps: process.env.AI_GAME_FPS ? Number(process.env.AI_GAME_FPS) : undefined,
          context: {
            role: play.uploader_role ?? "player",
            title: play.title,
            notes: play.notes,
            teamColor: play.team_color,
            attackDirection: play.attack_direction,
            durationSec: play.duration_seconds ?? 0,
            trackedPlayer: play.tracked_player,
            declaredOutcome: null,
          },
        });

        const found = game.tracked_player_found && game.player_stats.length > 0;
        const { error: uErr } = await supabase
          .from("plays")
          .update({
            status: "ready",
            outcome: "other",
            confidence: game.confidence,
            what_happened: found
              ? game.summary ||
                `Tallied ${game.player_stats.length} of your possessions from this game.`
              : "Couldn't confidently find the player you described in this game. Re-upload with a clearer jersey number/color, or clip your key possessions instead.",
            player_stats: found ? (game.player_stats as unknown as typeof play.player_stats) : null,
            start_seconds: 0,
            end_seconds: play.duration_seconds ?? 0,
          })
          .eq("id", play.id);
        if (uErr) throw new Error(uErr.message);
        return { ok: true, possessions: game.player_stats.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Game analysis failed";
        await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
        throw new Error(msg);
      }
    }

    // --- 2b) SHORT CLIP: base64-inline the possession/jumpshot pipeline ---
    let videoDataUrl: string;
    try {
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      videoDataUrl = `data:${mimeType};base64,${btoa(bin)}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not encode video";
      await supabase.from("plays").update({ status: "failed", error: msg }).eq("id", play.id);
      throw new Error(msg);
    }

    let result;
    try {
      if (play.kind === "jumpshot") {
        result = await runJumpshotAnalysis({
          videoDataUrl,
          videoRemoteUrl,
          apiKey: modelConfig.apiKey,
          provider: modelConfig.provider,
          model: modelConfig.model,
          notes: play.notes,
        });
      } else {
        // HYBRID: OBSERVER_PROVIDER (+ optional OBSERVER_MODEL) runs Pass 1 on a
        // different model — e.g. a perception specialist watches while the main
        // provider judges. Unset = same model for both passes.
        let observer: ModelConfig | undefined;
        const observerProvider = process.env.OBSERVER_PROVIDER?.trim().toLowerCase();
        if (observerProvider) {
          observer = resolveProviderConfig(
            observerProvider as Provider,
            process.env,
            process.env.OBSERVER_MODEL || undefined,
          );
        }
        result = await runPossessionAnalysis({
          videoDataUrl,
          videoRemoteUrl,
          apiKey: modelConfig.apiKey,
          provider: modelConfig.provider,
          model: modelConfig.model,
          observer,
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
      }
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
