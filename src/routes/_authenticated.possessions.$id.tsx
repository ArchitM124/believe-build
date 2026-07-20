import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Loader2,
  Share2,
  Flag,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { analyzePossession } from "@/lib/analyze-possession.functions";
import { STALE_AFTER_MS } from "@/lib/analysis-constants";
import { clipWindow, formatClock } from "@/lib/clip-window";

export const Route = createFileRoute("/_authenticated/possessions/$id")({
  head: () => ({
    meta: [{ title: "Possession — PlayIQ" }, { name: "robots", content: "noindex" }],
  }),
  component: PossessionDetail,
});

type Play = {
  id: string;
  title: string | null;
  notes: string | null;
  kind: string;
  game_type: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  error: string | null;
  outcome: string;
  what_happened: string | null;
  what_went_right: string | null;
  what_went_wrong: string | null;
  alternative: string | null;
  confidence: "low" | "medium" | "high";
  flagged: boolean;
  video_path: string | null;
  duration_seconds: number | null;
  share_id: string;
  tracked_player: string | null;
  updated_at: string;
  created_at: string;
};

const OUTCOME_LABEL: Record<string, string> = {
  made_shot: "Made shot",
  missed_shot: "Missed shot",
  turnover: "Turnover",
  defensive_stop: "D stop",
  defensive_breakdown: "D breakdown",
  foul: "Foul",
  other: "Other",
};

function PossessionDetail() {
  const { id } = Route.useParams();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: play, refetch } = useQuery({
    queryKey: ["possession", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("plays").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Play | null;
    },
    refetchInterval: (q) => {
      const p = q.state.data as Play | null;
      return p && (p.status === "processing" || p.status === "uploading") ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!play?.video_path) return;
    supabase.storage
      .from("game-videos")
      .createSignedUrl(play.video_path, 60 * 60)
      .then(({ data }) => {
        if (data?.signedUrl) setVideoUrl(data.signedUrl);
      });
  }, [play?.video_path]);

  // Self-heal: restart analysis only once it's been stuck long enough to be
  // genuinely abandoned (STALE_AFTER_MS exceeds a real run, so a healthy
  // in-progress job is never duplicated; the server also guards against dupes).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!play || resumedRef.current) return;
    const stalled =
      (play.status === "processing" || play.status === "uploading") &&
      play.video_path != null &&
      Date.now() - new Date(play.updated_at).getTime() > STALE_AFTER_MS;
    if (!stalled) return;
    resumedRef.current = true;
    void analyzePossession({ data: { possessionId: play.id } })
      .then(() => refetch())
      .catch(() => {
        resumedRef.current = false;
      });
  }, [play, refetch]);

  const reanalyze = async () => {
    setReanalyzing(true);
    try {
      await analyzePossession({ data: { possessionId: id } });
      toast.success("Re-analyzed");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setReanalyzing(false);
    }
  };

  const copyShare = () => {
    if (!play) return;
    const url = `${window.location.origin}/share/${play.share_id}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  if (!play) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex items-center justify-between">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All possessions
        </Link>
        <div className="flex gap-2">
          {play.status === "ready" && play.kind !== "game" && (
            <>
              <Button variant="outline" size="sm" onClick={copyShare}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share
              </Button>
              <Button variant="outline" size="sm" onClick={reanalyze} disabled={reanalyzing}>
                {reanalyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-run
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2">
          {play.kind !== "possession" && (
            <Badge variant="secondary" className="text-[10px] uppercase">
              {play.kind === "game"
                ? play.game_type === "organized"
                  ? "game"
                  : "pickup game"
                : "jumpshot"}
            </Badge>
          )}
          {play.tracked_player && (
            <Badge variant="outline" className="text-[10px]">
              Focus: {play.tracked_player}
            </Badge>
          )}
          {play.flagged && (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Flag className="h-3 w-3" /> flagged
            </span>
          )}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {play.title ?? "Untitled possession"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{new Date(play.created_at).toLocaleString()}</span>
          {play.duration_seconds != null && <span>· {play.duration_seconds}s</span>}
          <StatusInline status={play.status} />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-black/60">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            crossOrigin="anonymous"
            className="aspect-video w-full"
          />
        ) : play.video_path ? (
          <div className="aspect-video grid place-items-center court-grid">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="mt-2 text-xs text-muted-foreground">Loading clip…</p>
            </div>
          </div>
        ) : (
          <div className="aspect-video grid place-items-center court-grid">
            <div className="text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                No clip attached to this possession.
              </p>
            </div>
          </div>
        )}
      </div>

      {play.kind === "game" && videoUrl && <GameClipper play={play} videoRef={videoRef} />}

      {play.status === "processing" && (
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 animate-pulse text-primary" />
            <div>
              <div className="font-medium">AI is breaking this down</div>
              <p className="text-xs text-muted-foreground">
                Usually a few seconds for a single possession.
              </p>
            </div>
          </div>
        </div>
      )}

      {play.status === "failed" && (
        <div className="mt-6 rounded-lg border border-[color:var(--bad)]/40 bg-[color:var(--bad)]/10 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-[color:var(--bad)]" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Analysis failed</div>
              <p className="text-xs text-muted-foreground">{play.error ?? "Unknown error"}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={reanalyze}
                disabled={reanalyzing}
              >
                {reanalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {play.status === "ready" && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px] uppercase">
              {OUTCOME_LABEL[play.outcome] ?? play.outcome}
            </Badge>
            <span className={`text-[10px] uppercase tracking-wider ${confColor(play.confidence)}`}>
              {play.confidence} confidence
            </span>
          </div>

          {play.what_happened && (
            <p className="mt-4 text-base leading-relaxed">{play.what_happened}</p>
          )}

          {play.notes && (
            <div className="mt-5 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-[0.2em]">Your notes · </span>
              {play.notes}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {play.what_went_right && (
              <Section
                label={play.kind === "jumpshot" ? "What's working" : "What went right"}
                body={play.what_went_right}
                tone="good"
              />
            )}
            {play.what_went_wrong && (
              <Section
                label={play.kind === "jumpshot" ? "Costing you makes" : "What went wrong"}
                body={play.what_went_wrong}
                tone="bad"
              />
            )}
            {play.alternative && (
              <Section
                label={play.kind === "jumpshot" ? "Drills to fix it" : "Do differently next time"}
                body={play.alternative}
                tone="warn"
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function confColor(c: "low" | "medium" | "high") {
  return c === "high"
    ? "text-[color:var(--good)]"
    : c === "low"
      ? "text-[color:var(--bad)]"
      : "text-[color:var(--warn)]";
}

function StatusInline({ status }: { status: string }) {
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 text-[color:var(--good)]">
        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
      </span>
    );
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 text-[color:var(--warn)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-[color:var(--bad)]">
        <AlertCircle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  return <span>· {status}</span>;
}

function Section({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone: "good" | "bad" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-[color:var(--good)]"
      : tone === "bad"
        ? "text-[color:var(--bad)]"
        : "text-[color:var(--warn)]";
  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.25em] ${color}`}>
        {label}
      </div>
      <p className="mt-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

/** captureStream is real in modern browsers but missing from TS's DOM types. */
type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream };

function GameClipper({
  play,
  videoRef,
}: {
  play: Play;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [len, setLen] = useState("8");
  const [trackedPlayer, setTrackedPlayer] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");

  const clip = async () => {
    const v = videoRef.current as CapturableVideo | null;
    if (!v) return;
    if (typeof v.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      return toast.error(
        "In-app clipping isn't supported in this browser — trim the moment in your Photos app and upload it as a clip.",
      );
    }
    const { start, end } = clipWindow(v.currentTime, Number(len));
    if (end - start < 1) {
      return toast.error("Play the game to just AFTER the moment, then clip backward from there.");
    }
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mimeType) return toast.error("This browser can't record video clips.");

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return toast.error("Not signed in");

    setBusy(true);
    try {
      // Seek to the window start and wait for the frame.
      setPhase("Rewinding…");
      v.pause();
      await new Promise<void>((res) => {
        const done = () => {
          v.removeEventListener("seeked", done);
          res();
        };
        v.addEventListener("seeked", done);
        v.currentTime = start;
      });

      // Record the window in real time off the playing video.
      setPhase(`Capturing ${Math.round(end - start)}s…`);
      const stream = v.captureStream!();
      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((res) => {
        rec.onstop = () => res();
      });
      const stopAll = () => {
        if (rec.state !== "inactive") rec.stop();
        v.pause();
        v.removeEventListener("timeupdate", onTime);
      };
      const onTime = () => {
        if (v.currentTime >= end - 0.05) stopAll();
      };
      v.addEventListener("timeupdate", onTime);
      const safety = setTimeout(stopAll, (end - start) * 1000 + 4000);
      rec.start(250);
      await v.play();
      await stopped;
      clearTimeout(safety);

      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 5_000) throw new Error("Capture produced no video — try again");

      // Save as a regular possession clip and analyze it.
      setPhase("Uploading clip…");
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const { data: row, error: iErr } = await supabase
        .from("plays")
        .insert({
          user_id: uid,
          kind: "possession",
          title: `${play.title ?? "Game"} · clip @ ${formatClock(start)}`,
          notes: `Clipped in-app from the ${play.game_type === "organized" ? "game" : "pickup game"} "${play.title ?? "Game"}" (${formatClock(start)}–${formatClock(end)}).`,
          tracked_player: trackedPlayer.trim() || null,
          duration_seconds: Math.round(end - start),
          status: "uploading",
        })
        .select()
        .single();
      if (iErr || !row) throw new Error(iErr?.message ?? "Could not create the clip");

      const path = `${uid}/possessions/${row.id}/clip.${ext}`;
      const { error: upErr } = await supabase.storage.from("game-videos").upload(path, blob, {
        cacheControl: "3600",
        upsert: false,
        contentType: mimeType,
      });
      if (upErr) {
        await supabase
          .from("plays")
          .update({ status: "failed", error: upErr.message })
          .eq("id", row.id);
        throw new Error(upErr.message);
      }
      await supabase.from("plays").update({ video_path: path }).eq("id", row.id);

      void analyzePossession({ data: { possessionId: row.id } }).catch(async (err) => {
        await supabase
          .from("plays")
          .update({
            status: "failed",
            error: err instanceof Error ? err.message : "Analysis failed",
          })
          .eq("id", row.id);
      });
      toast.success("Clip saved — the AI is on it. Find it in your film room.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clipping failed");
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Scissors className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Clip this game</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Watch the game above. Right after something happens, clip backward from the playhead — the
        clip becomes a possession and gets the full AI breakdown.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[110px_1fr_auto]">
        <div className="space-y-1.5">
          <Label>Length</Label>
          <Select value={len} onValueChange={setLen}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4s</SelectItem>
              <SelectItem value="8">8s</SelectItem>
              <SelectItem value="12">12s</SelectItem>
              <SelectItem value="16">16s</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clip_tracked">Focus on one player (optional)</Label>
          <Input
            id="clip_tracked"
            value={trackedPlayer}
            onChange={(e) => setTrackedPlayer(e.target.value)}
            placeholder="'white #23' · 'gray hoodie, starts left corner'"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={clip} disabled={busy} className="gap-2">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {phase || "Working…"}
              </>
            ) : (
              <>
                <Scissors className="h-4 w-4" /> Clip last {len}s
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
