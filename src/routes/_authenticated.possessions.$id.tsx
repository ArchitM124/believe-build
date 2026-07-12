import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Share2,
  Flag,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { analyzePossession } from "@/lib/analyze-possession.functions";

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
  uploader_role: "coach" | "player";
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

  // Self-heal: if analysis stalled (tab closed before it finished), restart it
  // once the clip has been stuck for over 2 minutes. Safe to re-run.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!play || resumedRef.current) return;
    const stalled =
      (play.status === "processing" || play.status === "uploading") &&
      play.video_path != null &&
      Date.now() - new Date(play.updated_at).getTime() > 120_000;
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
          {play.status === "ready" && (
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
          <Badge variant="secondary" className="text-[10px] uppercase">
            {play.uploader_role}
          </Badge>
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
          <video src={videoUrl} controls className="aspect-video w-full" />
        ) : (
          <div className="aspect-video grid place-items-center court-grid">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="mt-2 text-xs text-muted-foreground">Loading clip…</p>
            </div>
          </div>
        )}
      </div>

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
              <Section label="What went right" body={play.what_went_right} tone="good" />
            )}
            {play.what_went_wrong && (
              <Section label="What went wrong" body={play.what_went_wrong} tone="bad" />
            )}
            {play.alternative && (
              <Section label="Do differently next time" body={play.alternative} tone="warn" />
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
