import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Loader2, Gauge, Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";
import { generatePlayerRating } from "@/lib/rating.functions";
import { MIN_POSSESSIONS } from "@/lib/player-rating";

export const Route = createFileRoute("/_authenticated/rating")({
  head: () => ({
    meta: [{ title: "Player rating — PlayIQ" }, { name: "robots", content: "noindex" }],
  }),
  component: RatingPage,
});

type TrackedPlay = {
  id: string;
  title: string | null;
  tracked_player: string | null;
  outcome: string;
  created_at: string;
};

type RatingRow = {
  id: string;
  tracked_player: string;
  possessions_used: number;
  sub_scores: Record<string, number | null>;
  overall: number;
  report: {
    headline?: string;
    strengths?: string[];
    weaknesses?: string[];
    improve?: string[];
    evidence?: string[];
    tier?: string;
    archetype?: string;
  } | null;
  created_at: string;
};

/** Games (pickup or organized) required before your overall is revealed. */
export const GAMES_TO_UNLOCK = 5;

const SUB_LABEL: Record<string, string> = {
  scoring: "Scoring",
  ball_security: "Ball security",
  playmaking: "Playmaking",
  decision_making: "Decision-making",
  defense: "Defense",
  activity: "Activity",
};

function RatingPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: plays } = useQuery({
    queryKey: ["rateable-plays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plays")
        .select("id,title,tracked_player,outcome,created_at")
        .eq("status", "ready")
        .not("tracked_player", "is", null)
        .not("player_stats", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TrackedPlay[];
    },
  });

  const { data: gamesCount } = useQuery({
    queryKey: ["games-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("plays")
        .select("id", { count: "exact", head: true })
        .eq("kind", "game")
        .eq("status", "ready");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: ratings, isLoading: ratingsLoading } = useQuery({
    queryKey: ["ratings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ratings")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RatingRow[];
    },
  });

  const groups = new Map<string, string[]>();
  for (const p of plays ?? []) {
    const key = p.tracked_player ?? "";
    groups.set(key, [...(groups.get(key) ?? []), p.id]);
  }
  const distinctSelected = new Set(
    (plays ?? []).filter((p) => selected.has(p.id)).map((p) => p.tracked_player),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = async () => {
    setBusy(true);
    try {
      const res = await generatePlayerRating({ data: { playIds: [...selected] } });
      toast.success(`Rating ready: ${res.overall} overall`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["ratings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rating failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">Player rating</div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your 2K-style rating</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick at least {MIN_POSSESSIONS} analyzed clips of the same player. The numbers are computed
        from counted events on film — the AI writes the scouting report, not the score.
      </p>

      {(gamesCount ?? 0) < GAMES_TO_UNLOCK && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card/60 p-4">
          <Lock className="h-4 w-4 shrink-0 text-primary" />
          <div className="text-sm">
            <span className="font-medium">
              Your overall is hidden until you upload {GAMES_TO_UNLOCK} games.
            </span>{" "}
            <span className="text-muted-foreground">
              {gamesCount ?? 0}/{GAMES_TO_UNLOCK} uploaded — pickup or organized both count.
              Sub-scores and scouting reports stay visible so you can track what to work on.
            </span>
          </div>
        </div>
      )}

      {/* Clip picker */}
      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Pick clips</h2>
          <div className="flex flex-wrap gap-2">
            {[...groups.entries()].map(([player, ids]) => (
              <button
                key={player}
                onClick={() => setSelected(new Set(ids))}
                className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/60"
              >
                {player} · {ids.length}
              </button>
            ))}
          </div>
        </div>

        {!plays?.length ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No rateable clips yet. Upload possessions with “Focus on one player” filled in — once
            they're analyzed, they show up here.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {plays.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  id={`pick-${p.id}`}
                />
                <label htmlFor={`pick-${p.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block truncate text-sm">{p.title ?? "Untitled possession"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.tracked_player} · {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </label>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {p.outcome.replace("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {distinctSelected.size > 1 && (
          <p className="mt-3 text-xs text-[color:var(--warn)]">
            Heads up: the selected clips track {distinctSelected.size} different player descriptions
            — a rating only makes sense for one player.
          </p>
        )}

        <Button
          className="mt-4 gap-2"
          disabled={busy || selected.size < MIN_POSSESSIONS}
          onClick={generate}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Gauge className="h-4 w-4" /> Generate rating ({selected.size} clip
              {selected.size === 1 ? "" : "s"})
            </>
          )}
        </Button>
      </section>

      {/* Past ratings */}
      <section className="mt-10 space-y-6">
        {ratingsLoading ? (
          <div className="grid place-items-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          (ratings ?? []).map((r) => (
            <RatingCard
              key={r.id}
              r={r}
              locked={(gamesCount ?? 0) < GAMES_TO_UNLOCK}
              gamesCount={gamesCount ?? 0}
            />
          ))
        )}
      </section>
    </main>
  );
}

function RatingCard({
  r,
  locked,
  gamesCount,
}: {
  r: RatingRow;
  locked: boolean;
  gamesCount: number;
}) {
  const report = r.report ?? {};
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.25em] text-primary">Game score</div>
          <h3 className="mt-1 text-xl font-semibold">{r.tracked_player}</h3>
          {/* Archetype names the shape of the game — safe to show even when the
              overall is locked, since it doesn't reveal the number. */}
          {report.archetype && (
            <Badge className="mt-2" variant="secondary">
              {report.archetype}
            </Badge>
          )}
          {report.headline && (
            <p className="mt-2 text-sm text-muted-foreground">{report.headline}</p>
          )}
        </div>
        <div className="text-right">
          {locked ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-border px-4 py-2">
              <Lock className="h-6 w-6 text-primary" />
              <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                {gamesCount}/{GAMES_TO_UNLOCK} games
              </div>
            </div>
          ) : (
            <>
              <div className="text-5xl font-bold tracking-tight text-primary">{r.overall}</div>
              {report.tier && (
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                  {report.tier}
                </div>
              )}
            </>
          )}
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {locked ? "overall locked" : "overall"} · {r.possessions_used} possessions
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {Object.entries(SUB_LABEL).map(([key, label]) => {
          const score = r.sub_scores?.[key] ?? null;
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs">
                <span>{label}</span>
                <span className="font-semibold">{score ?? "—"}</span>
              </div>
              <Progress value={score === null ? 0 : ((score - 25) / 74) * 100} className="mt-1" />
            </div>
          );
        })}
      </div>

      {(report.strengths?.length || report.weaknesses?.length || report.improve?.length) && (
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <ReportList label="Strengths" tone="good" items={report.strengths} />
          <ReportList label="Weaknesses" tone="bad" items={report.weaknesses} />
          <ReportList label="To raise it" tone="warn" items={report.improve} />
        </div>
      )}

      {report.evidence?.length ? (
        <p className="mt-5 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-[0.2em]">Receipts · </span>
          {report.evidence.join(" · ")}
        </p>
      ) : null}

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" />A grade of this film only — it sharpens as you
        rate more sessions. Generated {new Date(r.created_at).toLocaleDateString()}.
      </p>
    </div>
  );
}

function ReportList({
  label,
  items,
  tone,
}: {
  label: string;
  items?: string[];
  tone: "good" | "bad" | "warn";
}) {
  if (!items?.length) return null;
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
      <ul className="mt-2 space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="text-sm leading-relaxed">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
