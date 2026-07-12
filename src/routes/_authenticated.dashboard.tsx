import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Film, CheckCircle2, AlertCircle, Loader2, Plus, ArrowRight, Flag,
} from "lucide-react";
import { toast } from "sonner";
import { analyzePossession } from "@/lib/analyze-possession.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Possessions — PlayIQ" }, { name: "robots", content: "noindex" }] }),
  component: Dashboard,
});

type Possession = {
  id: string;
  title: string | null;
  notes: string | null;
  uploader_role: "coach" | "player";
  status: "uploading" | "processing" | "ready" | "failed";
  error: string | null;
  outcome: string;
  what_happened: string | null;
  confidence: "low" | "medium" | "high";
  flagged: boolean;
  duration_seconds: number | null;
  video_path: string | null;
  updated_at: string;
  created_at: string;
};

const OUTCOME_LABEL: Record<string, string> = {
  made_shot: "Made shot", missed_shot: "Missed shot", turnover: "Turnover",
  defensive_stop: "D stop", defensive_breakdown: "D breakdown", foul: "Foul", other: "Other",
};

function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["possessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plays")
        .select("id,title,notes,uploader_role,status,error,outcome,what_happened,confidence,flagged,duration_seconds,video_path,updated_at,created_at")
        .not("user_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Possession[];
    },
    refetchInterval: (q) => {
      const list = (q.state.data as Possession[] | undefined) ?? [];
      return list.some((p) => p.status === "processing" || p.status === "uploading") ? 3000 : false;
    },
  });

  // Self-heal: if a clip has been stuck mid-analysis for over 2 minutes (e.g.
  // the uploader closed the tab before the background analysis finished),
  // restart it. analyzePossession is safe to re-run — it just overwrites.
  const resumedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!rows) return;
    const STALL_MS = 120_000;
    const now = Date.now();
    for (const p of rows) {
      const stalled =
        (p.status === "processing" || p.status === "uploading") &&
        p.video_path != null &&
        now - new Date(p.updated_at).getTime() > STALL_MS &&
        !resumedRef.current.has(p.id);
      if (!stalled) continue;
      resumedRef.current.add(p.id);
      void analyzePossession({ data: { possessionId: p.id } })
        .then(() => qc.invalidateQueries({ queryKey: ["possessions"] }))
        .catch(() => {
          // The server function marks the row failed on errors it can see.
          resumedRef.current.delete(p.id); // allow a later retry
        });
    }
  }, [rows, qc]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Film room</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your possessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {user?.email}. Upload one possession at a time — coach or player.
          </p>
        </div>
        <UploadDialog onDone={() => qc.invalidateQueries({ queryKey: ["possessions"] })} />
      </div>

      <div className="mt-8">
        {isLoading ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !rows?.length ? (
          <EmptyState onDone={() => qc.invalidateQueries({ queryKey: ["possessions"] })} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => <PossessionCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: Possession["status"] }) {
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

function PossessionCard({ p }: { p: Possession }) {
  return (
    <Link
      to="/possessions/$id"
      params={{ id: p.id }}
      className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{p.title ?? "Untitled possession"}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {new Date(p.created_at).toLocaleString()}
          </p>
        </div>
        <Film className="h-5 w-5 shrink-0 text-primary/70" />
      </div>

      {p.status === "ready" && p.what_happened && (
        <p className="mt-3 line-clamp-2 text-xs text-foreground/80">{p.what_happened}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px] uppercase">{p.uploader_role}</Badge>
        {p.status === "ready" && (
          <Badge variant="outline" className="text-[10px] uppercase">{OUTCOME_LABEL[p.outcome] ?? p.outcome}</Badge>
        )}
        {p.flagged && (
          <span className="inline-flex items-center gap-1 text-[10px] text-primary">
            <Flag className="h-3 w-3" /> flagged
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <StatusPill status={p.status} />
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      {p.error && (
        <p className="mt-3 line-clamp-2 text-xs text-[color:var(--bad)]">{p.error}</p>
      )}
    </Link>
  );
}

function EmptyState({ onDone }: { onDone: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center court-grid">
      <Film className="mx-auto h-10 w-10 text-primary" />
      <h3 className="mt-4 text-xl font-semibold">No possessions yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">Upload one clip — the AI breaks it down for you.</p>
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
    // Must match MAX_VIDEO_BYTES in analyze-possession.functions.ts — the model
    // takes the clip inline, so anything larger is rejected before analysis.
    if (file.size > 20 * 1024 * 1024)
      return toast.error(
        "Clip exceeds 20MB. Trim to a single possession (≈≤15s at 1080p, ≤30s at 720p).",
      );

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return toast.error("Not signed in");

    setBusy(true);
    setProgress(5);

    let duration: number | null = null;
    try { duration = await readDuration(file); } catch { /* ignore */ }

    // Insert possession row first
    const { data: play, error: pErr } = await supabase
      .from("plays")
      .insert({
        user_id: uid,
        title: String(fd.get("title") || "Untitled possession"),
        notes: (fd.get("notes") as string) || null,
        uploader_role: (fd.get("uploader_role") as "coach" | "player") || "coach",
        duration_seconds: duration,
        status: "uploading",
      })
      .select()
      .single();
    if (pErr || !play) { setBusy(false); return toast.error(pErr?.message ?? "Failed to create possession"); }

    const path = `${uid}/possessions/${play.id}/${file.name}`;
    setProgress(20);
    const { error: upErr } = await supabase.storage.from("game-videos").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "video/mp4",
    });
    if (upErr) {
      await supabase.from("plays").update({ status: "failed", error: upErr.message }).eq("id", play.id);
      setBusy(false);
      return toast.error(upErr.message);
    }

    setProgress(70);
    await supabase.from("plays").update({ video_path: path }).eq("id", play.id);

    // Upload is done — hand the user straight to the possession page. Analysis
    // runs in the background; the dashboard and detail views poll on `status`,
    // so we don't block the dialog on a full video round-trip to the model.
    setProgress(100);
    setBusy(false);
    onDone();
    setOpen(false);
    setFile(null);
    setProgress(0);
    toast.success("Uploaded — the AI is breaking it down");
    navigate({ to: "/possessions/$id", params: { id: play.id } });

    void analyzePossession({ data: { possessionId: play.id } })
      .then(() => onDone())
      .catch(async (err) => {
        // The server function already marks the row failed for errors it sees;
        // this covers the case where the request never reached the server.
        await supabase
          .from("plays")
          .update({
            status: "failed",
            error: err instanceof Error ? err.message : "Analysis failed",
          })
          .eq("id", play.id);
        onDone();
      });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Upload possession</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a possession</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Clip (MP4 / MOV, one possession, up to 20MB)</Label>
            <div
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-md border border-dashed border-border bg-muted/30 p-6 text-center hover:border-primary/60"
            >
              <Upload className="mx-auto h-6 w-6 text-primary" />
              <p className="mt-2 text-sm">{file ? file.name : "Click to select a clip"}</p>
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
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" placeholder="Q3 · pick-and-roll switch" required />
            </div>
            <div className="space-y-1.5">
              <Label>I am a…</Label>
              <Select name="uploader_role" defaultValue="coach">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coach">Coach</SelectItem>
                  <SelectItem value="player">Player</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes for the AI (optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Context helps: what was the set, what read did you want, what happened?"
              />
            </div>
          </div>

          {busy && (
            <div className="space-y-1">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">
                {progress < 70 ? "Uploading clip…" : progress < 100 ? "Running AI breakdown…" : "Done"}
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
