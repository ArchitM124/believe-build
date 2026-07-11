import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ArrowLeft, Loader2, Play, Pause, Share2, Flag, Sparkles, CheckCircle2, AlertCircle,
  RefreshCw, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { analyzeGame } from "@/lib/analyze-game.functions";

export const Route = createFileRoute("/_authenticated/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — PlayIQ" }, { name: "robots", content: "noindex" }] }),
  component: GameDetail,
});

type Play = {
  id: string;
  game_id: string;
  possession_index: number;
  start_seconds: number;
  end_seconds: number;
  outcome: string;
  what_happened: string;
  what_went_right: string | null;
  what_went_wrong: string | null;
  alternative: string | null;
  confidence: "low" | "medium" | "high";
  flagged: boolean;
  share_id: string;
};

type Game = {
  id: string; title: string; opponent: string | null; game_date: string | null;
  camera_angle: string; status: string; error: string | null;
  video_path: string | null; duration_seconds: number | null;
};

const OUTCOME_LABEL: Record<string, string> = {
  made_shot: "Made shot", missed_shot: "Missed shot", turnover: "Turnover",
  defensive_stop: "D stop", defensive_breakdown: "D breakdown", foul: "Foul", other: "Other",
};

function GameDetail() {
  const { gameId } = Route.useParams();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reanalyzing, setReanalyzing] = useState(false);

  const { data: game, refetch: refetchGame } = useQuery({
    queryKey: ["game", gameId],
    queryFn: async () => {
      const { data, error } = await supabase.from("games").select("*").eq("id", gameId).maybeSingle();
      if (error) throw error;
      return data as Game | null;
    },
    refetchInterval: (q) => {
      const g = q.state.data as Game | null;
      return g && (g.status === "processing" || g.status === "uploading") ? 3000 : false;
    },
  });

  const { data: plays, refetch: refetchPlays } = useQuery({
    queryKey: ["plays", gameId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plays").select("*").eq("game_id", gameId).order("possession_index");
      if (error) throw error;
      return (data ?? []) as Play[];
    },
  });

  useEffect(() => {
    if (game?.status === "ready") refetchPlays();
  }, [game?.status, refetchPlays]);

  useEffect(() => {
    if (!game?.video_path) return;
    supabase.storage.from("game-videos").createSignedUrl(game.video_path, 60 * 60).then(({ data }) => {
      if (data?.signedUrl) setVideoUrl(data.signedUrl);
    });
  }, [game?.video_path]);

  const filtered = useMemo(() => {
    if (!plays) return [];
    if (filter === "all") return plays;
    if (filter === "flagged") return plays.filter((p) => p.flagged);
    return plays.filter((p) => p.outcome === filter);
  }, [plays, filter]);

  const jumpTo = (p: Play) => {
    setActiveId(p.id);
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = p.start_seconds;
    v.play().catch(() => {});
  };

  const reanalyze = async () => {
    setReanalyzing(true);
    try {
      await analyzeGame({ data: { gameId } });
      toast.success("Re-analyzed");
      refetchGame(); refetchPlays();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setReanalyzing(false);
    }
  };

  if (!game) {
    return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center justify-between">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All games
        </Link>
        {game.status === "ready" && (
          <Button variant="outline" size="sm" onClick={reanalyze} disabled={reanalyzing}>
            {reanalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-run analysis</>}
          </Button>
        )}
      </div>

      <div className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight">{game.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {game.opponent && <span>vs {game.opponent}</span>}
          {game.game_date && <span>· {new Date(game.game_date).toLocaleDateString()}</span>}
          <span>· {game.camera_angle} angle</span>
          <StatusInline status={game.status} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-black/60">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="aspect-video w-full"
              />
            ) : (
              <div className="aspect-video grid place-items-center court-grid">
                <div className="text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  <p className="mt-2 text-xs text-muted-foreground">Loading film…</p>
                </div>
              </div>
            )}
          </div>

          {game.status === "processing" && (
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 animate-pulse text-primary" />
                <div>
                  <div className="font-medium">AI is watching your film</div>
                  <p className="text-xs text-muted-foreground">Usually done in 1–3 minutes for the MVP pipeline.</p>
                </div>
              </div>
            </div>
          )}

          {game.status === "failed" && (
            <div className="rounded-lg border border-[color:var(--bad)]/40 bg-[color:var(--bad)]/10 p-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-[color:var(--bad)]" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Analysis failed</div>
                  <p className="text-xs text-muted-foreground">{game.error ?? "Unknown error"}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={reanalyze} disabled={reanalyzing}>
                    {reanalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry analysis"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Play cards</div>
            <div className="text-xs text-muted-foreground">
              {plays?.length ?? 0} possessions
            </div>
          </div>

          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => v && setFilter(v)}
            className="flex flex-wrap justify-start gap-1"
          >
            {[
              ["all", "All"], ["flagged", "Flagged"], ["made_shot", "Scores"],
              ["turnover", "Turnovers"], ["defensive_breakdown", "D breakdowns"], ["defensive_stop", "D stops"],
            ].map(([v, l]) => (
              <ToggleGroupItem key={v} value={v} size="sm" className="text-xs">
                {l}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="max-h-[calc(100vh-16rem)] space-y-3 overflow-y-auto pr-1">
            {!filtered.length && plays?.length ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No possessions match this filter.
              </div>
            ) : !plays?.length && game.status === "ready" ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No possessions returned.
              </div>
            ) : (
              filtered.map((p) => (
                <PlayCardItem
                  key={p.id}
                  play={p}
                  active={p.id === activeId}
                  onJump={() => jumpTo(p)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusInline({ status }: { status: string }) {
  if (status === "ready") return <span className="inline-flex items-center gap-1 text-[color:var(--good)]"><CheckCircle2 className="h-3.5 w-3.5" /> Ready</span>;
  if (status === "processing") return <span className="inline-flex items-center gap-1 text-[color:var(--warn)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1 text-[color:var(--bad)]"><AlertCircle className="h-3.5 w-3.5" /> Failed</span>;
  return <span>· {status}</span>;
}

function PlayCardItem({ play, active, onJump }: { play: Play; active: boolean; onJump: () => void }) {
  const conf = play.confidence;
  const confColor = conf === "high" ? "text-[color:var(--good)]" : conf === "low" ? "text-[color:var(--bad)]" : "text-[color:var(--warn)]";
  const share = `${typeof window !== "undefined" ? window.location.origin : ""}/share/${play.share_id}`;

  return (
    <div className={`rounded-lg border p-4 transition-colors ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-border/80"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="scoreboard text-xs font-medium text-muted-foreground">
              #{play.possession_index} · {fmt(play.start_seconds)}–{fmt(play.end_seconds)}
            </span>
            {play.flagged && <Flag className="h-3 w-3 text-primary" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] uppercase">{OUTCOME_LABEL[play.outcome] ?? play.outcome}</Badge>
            <span className={`text-[10px] uppercase tracking-wider ${confColor}`}>{conf} conf.</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={onJump} title="Jump to clip">
            <Play className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(share); toast.success("Share link copied"); }} title="Copy share link">
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed">{play.what_happened}</p>
      {play.what_went_right && <Section label="Right" body={play.what_went_right} tone="good" />}
      {play.what_went_wrong && <Section label="Wrong" body={play.what_went_wrong} tone="bad" />}
      {play.alternative && <Section label="Try" body={play.alternative} tone="warn" />}
    </div>
  );
}

function Section({ label, body, tone }: { label: string; body: string; tone: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-[color:var(--good)]" : tone === "bad" ? "text-[color:var(--bad)]" : "text-[color:var(--warn)]";
  return (
    <div className="mt-2">
      <span className={`mr-2 text-[10px] font-semibold uppercase tracking-[0.2em] ${color}`}>{label}</span>
      <span className="text-xs text-foreground/85">{body}</span>
    </div>
  );
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
