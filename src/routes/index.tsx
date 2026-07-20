import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Film, Sparkles, Share2, Clock } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
              P
            </div>
            <span className="text-lg font-semibold tracking-tight">PlayIQ</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Button asChild size="sm">
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden court-grid">
        <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.25em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              AI film room · MVP
            </div>
            <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Upload the game.
              <br />
              <span className="text-primary">Get the film session</span> in 15 minutes.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              PlayIQ breaks your game film into possessions and writes coaching notes for each one —
              what happened, what went right, what went wrong, and what to do next time.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link to="/auth">
                  Upload your first game <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Free during pilot · No credit card · Basketball only for MVP
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-32 top-16 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      </section>

      {/* How */}
      <section id="how" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-12 max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">The tape, taped</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Coaches spend 5+ hours per game on film. You have 20 minutes.
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Film,
                t: "1. Upload film",
                d: "Clips, jumpshots, or full games — pickup runs and organized games both count. Phone-tripod footage is perfect.",
              },
              {
                icon: Sparkles,
                t: "2. AI coaches YOU",
                d: "Possessions become play cards; jumpshots get a mechanics check that only flags what's costing you makes. Feedback talks to you: 'You attacked the middle…'",
              },
              {
                icon: Share2,
                t: "3. Earn your overall",
                d: "Counted events become 2K-style sub-scores. Upload 5 games to unlock your hidden overall — then share any breakdown with a link.",
              },
            ].map((s, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-6">
                <s.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-10 flex items-end justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-primary">
                Sample play card
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                What a possession looks like
              </h2>
            </div>
            <div className="scoreboard hidden text-sm text-muted-foreground md:block">
              Q2 · 6:42 · Poss #14
            </div>
          </div>
          <div className="grid gap-6 rounded-xl border border-border bg-card p-6 md:grid-cols-[1fr_2fr]">
            <div className="relative overflow-hidden rounded-lg bg-black/40 court-grid">
              <div className="aspect-video grid place-items-center">
                <div className="text-center">
                  <Clock className="mx-auto h-8 w-8 text-primary" />
                  <div className="scoreboard mt-2 text-2xl font-semibold">0:18</div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    clip length
                  </div>
                </div>
              </div>
              <div className="absolute left-3 top-3 rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
                Missed jumper
              </div>
              <div className="absolute right-3 top-3 rounded bg-good/20 px-2 py-1 text-xs font-semibold text-[color:var(--good)]">
                High confidence
              </div>
            </div>
            <div className="space-y-4">
              <Row
                label="What happened"
                body="Offense initiated a high pick-and-roll at the top of the key; ball-handler used the screen going left, defender fought over the top, and the ball-handler pulled up for a mid-range jumper that missed short."
              />
              <Row
                label="What went right"
                tone="good"
                body="The screener set a solid, stationary screen and held position long enough to force the switch decision."
              />
              <Row
                label="What went wrong"
                tone="bad"
                body="The roll man's defender was late to tag the roll, leaving a brief window to the rim that wasn't used — the ball-handler settled for a contested jumper instead."
              />
              <Row
                label="Do differently"
                tone="warn"
                body="Attack the rim off the switch, or a pocket pass to the rolling screener, likely had a higher expected value than the pull-up given the late tag."
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-balance">
            Stop scrubbing tape. Start coaching.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Join the pilot. Upload a game today, get feedback tonight.
          </p>
          <Button asChild size="lg" className="mt-8 gap-2">
            <Link to="/auth">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} PlayIQ · Basketball MVP
      </footer>
    </div>
  );
}

function Row({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone?: "good" | "bad" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-[color:var(--good)]"
      : tone === "bad"
        ? "text-[color:var(--bad)]"
        : tone === "warn"
          ? "text-[color:var(--warn)]"
          : "text-primary";
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-[0.2em] ${color}`}>{label}</div>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{body}</p>
    </div>
  );
}
