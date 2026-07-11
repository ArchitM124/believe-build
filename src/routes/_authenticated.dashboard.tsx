import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Upload, Film, Clock, CheckCircle2, AlertCircle, Loader2, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { analyzeGame } from "@/lib/analyze-game.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Games — PlayIQ" }, { name: "robots", content: "noindex" }] }),
  component: Dashboard,
});

type Game = {
  id: string;
  title: string;
  opponent: string | null;
  game_date: string | null;
  camera_angle: string;
  status: "uploading" | "processing" | "ready" | "failed";
  error: string | null;
  created_at: string;
  duration_seconds: number | null;
};

function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: games, isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Game[];
    },
    refetchInterval: (q) => {
      const rows = (q.state.data as Game[] | undefined) ?? [];
      return rows.some((g) => g.status === "processing" || g.status === "uploading") ? 3000 : false;
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Film room</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your games</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {user?.email}. Upload film, watch the AI break it down.
          </p>
        </div>
        <UploadDialog onDone={() => qc.invalidateQueries({ queryKey: ["games"] })} />
      </div>

      <div className="mt-8">
        {isLoading ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !games?.length ? (
          <EmptyState onDone={() => qc.invalidateQueries({ queryKey: ["games"] })} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {games.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: Game["status"] }) {
  const map = {
    uploading: { icon: Upload, label: "Uploading", color: "text-muted-foreground" },
    processing: { icon: Loader2, label: "Analyzing", color: "text-[color:var(--warn)]", spin: true },
    ready: { icon: CheckCircle2, label: "Ready", color: "text-[color:var(--good)]" },
    failed: { icon: AlertCircle, label: "Failed", color: "text-[color:var(--bad)]" },
  } as const;
  const s = map[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.color}`}>
      <Icon className={`h-3.5 w-3.5 ${"spin" in s && s.spin ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

function GameCard({ game }: { game: Game }) {
  return (
    <Link
      to="/games/$gameId"
      params={{ gameId: game.id }}
      className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{game.title}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {game.opponent ? `vs ${game.opponent}` : "No opponent"}
            {game.game_date ? ` · ${new Date(game.game_date).toLocaleDateString()}` : ""}
          </p>
        </div>
        <Film className="h-5 w-5 shrink-0 text-primary/70" />
      </div>
      <div className="mt-6 flex items-center justify-between">
        <StatusPill status={game.status} />
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      {game.error && (
        <p className="mt-3 line-clamp-2 text-xs text-[color:var(--bad)]">{game.error}</p>
      )}
    </Link>
  );
}

function EmptyState({ onDone }: { onDone: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center court-grid">
      <Film className="mx-auto h-10 w-10 text-primary" />
      <h3 className="mt-4 text-xl font-semibold">No games yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">Upload your first game film to start.</p>
      <div className="mt-6">
        <UploadDialog onDone={onDone} />
      </div>
    </div>
  );
}

function UploadDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!file) return toast.error("Pick a video file");
    if (file.size > 2 * 1024 * 1024 * 1024) return toast.error("File exceeds 2GB (MVP limit)");

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return toast.error("Not signed in");

    setBusy(true);
    setProgress(5);

    // Insert game row first
    const { data: game, error: gErr } = await supabase
      .from("games")
      .insert({
        user_id: uid,
        title: String(fd.get("title")),
        opponent: (fd.get("opponent") as string) || null,
        game_date: (fd.get("game_date") as string) || null,
        camera_angle: (fd.get("camera_angle") as "sideline" | "baseline" | "elevated" | "other") || "sideline",
        status: "uploading",
      })
      .select()
      .single();
    if (gErr || !game) { setBusy(false); return toast.error(gErr?.message ?? "Failed to create game"); }

    const path = `${uid}/${game.id}/${file.name}`;
    setProgress(15);
    const { error: upErr } = await supabase.storage.from("game-videos").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "video/mp4",
    });
    if (upErr) {
      await supabase.from("games").update({ status: "failed", error: upErr.message }).eq("id", game.id);
      setBusy(false);
      return toast.error(upErr.message);
    }

    // Try to read duration client-side (best effort)
    let duration: number | null = null;
    try {
      duration = await readDuration(file);
    } catch { /* ignore */ }

    setProgress(70);
    await supabase.from("games").update({ video_path: path, duration_seconds: duration }).eq("id", game.id);

    // Kick off analysis
    setProgress(85);
    try {
      await analyzeGame({ data: { gameId: game.id } });
      setProgress(100);
      toast.success("Analysis complete");
      onDone();
      setOpen(false);
      navigate({ to: "/games/$gameId", params: { gameId: game.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
      onDone();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> New game</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a new game</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Video file (MP4 / MOV, up to 2GB)</Label>
            <div
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-md border border-dashed border-border bg-muted/30 p-6 text-center hover:border-primary/60"
            >
              <Upload className="mx-auto h-6 w-6 text-primary" />
              <p className="mt-2 text-sm">{file ? file.name : "Click to select a video"}</p>
              {file && <p className="mt-1 text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="title">Game title</Label>
              <Input id="title" name="title" placeholder="Varsity vs Central — Jan 15" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opponent">Opponent</Label>
              <Input id="opponent" name="opponent" placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="game_date">Game date</Label>
              <Input id="game_date" name="game_date" type="date" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Camera angle</Label>
              <Select name="camera_angle" defaultValue="sideline">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sideline">Sideline (recommended)</SelectItem>
                  <SelectItem value="elevated">Elevated / press box</SelectItem>
                  <SelectItem value="baseline">Baseline</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {busy && (
            <div className="space-y-1">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">
                {progress < 70 ? "Uploading video…" : progress < 100 ? "Running AI film analysis…" : "Done"}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={busy || !file} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload & analyze"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.floor(v.duration)); };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("cannot read metadata")); };
    v.src = url;
  });
}
