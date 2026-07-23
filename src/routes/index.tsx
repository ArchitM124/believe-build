import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Gauge,
  Target,
  Crosshair,
  ShieldCheck,
  Video,
  Users,
  Share2,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

// The real rating facets and tiers — the landing shows exactly what the app produces.
const SUBSCORES: Array<[string, number]> = [
  ["Scoring", 82],
  ["Defense", 86],
  ["Ball security", 84],
  ["Playmaking", 71],
  ["Decision-making", 88],
  ["Activity", 90],
];

const TIERS: Array<[string, string]> = [
  ["Rough", "25–49"],
  ["Developing", "50–64"],
  ["Solid", "65–74"],
  ["Standout", "75–84"],
  ["Dominant", "85–92"],
  ["Elite", "93–99"],
];

const ARCHETYPES = [
  "Sharpshooter",
  "Slasher",
  "Bucket Getter",
  "Shot Creator",
  "Two-Way Wing",
  "Floor General",
  "Lead Guard",
  "Lockdown",
  "Menace",
  "Anchor",
  "Glue Guy",
  "Motor",
  "Gambler",
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary font-bold text-primary-foreground">
              P
            </div>
            <span className="text-lg font-semibold tracking-tight">PlayIQ</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Button asChild size="sm">
              <Link to="/auth">Get your rating</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden court-grid">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.25em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Get scouted by AI
            </div>
            <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Upload your game.
              <br />
              <span className="text-primary">Get your rating.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              PlayIQ's AI watches every possession you're in and builds a 2K-style rating out of 99
              — with a tier, an archetype, and the film to back up every point. Pickup or organized.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link to="/auth">
                  Find out your rating <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Free during pilot · No credit card · Basketball only for now
            </p>
          </div>

          {/* The money shot: a real-looking rating card */}
          <RatingCardMock />
        </div>
        <div className="pointer-events-none absolute -right-32 top-10 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      </section>

      {/* How */}
      <section id="how" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-12 max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">How it works</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Three steps from raw footage to a real rating.
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Video,
                t: "1. Upload your game",
                d: "Drop in a full game — pickup or organized — or single clips, or trim moments right in the app. Phone-tripod footage from the stands is perfect.",
              },
              {
                icon: Target,
                t: "2. Tell it who you are",
                d: "Your jersey number and color, or for pickup just your clothing and where you start. The AI finds you and tallies every possession you factor in — offense and defense.",
              },
              {
                icon: Gauge,
                t: "3. Get your rating",
                d: "An overall out of 99 with a tier and an archetype, built from what you actually did. Upload 5 games to unlock your true hidden overall.",
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

      {/* The rating: tiers + archetypes */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-12 max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">
              The number means something
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              A tier you can read. An archetype that's you.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every overall lands on a named tier, and the shape of your game earns an archetype —
              so &ldquo;78&rdquo; isn&rsquo;t a random number, it&rsquo;s a{" "}
              <span className="text-foreground">Standout · Sharpshooter</span>.
            </p>
          </div>

          {/* Tier ladder */}
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {TIERS.map(([name, range]) => {
              const isYou = name === "Standout";
              return (
                <div
                  key={name}
                  className={`rounded-lg border p-4 ${
                    isYou ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <div
                    className={`text-sm font-semibold ${isYou ? "text-primary" : "text-foreground"}`}
                  >
                    {name}
                  </div>
                  <div className="scoreboard mt-1 text-xs text-muted-foreground">{range}</div>
                  {isYou && (
                    <div className="mt-2 text-[10px] uppercase tracking-widest text-primary">
                      you are here
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Archetype chips */}
          <div className="mt-10">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              A few of the archetypes
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ARCHETYPES.map((a) => (
                <span
                  key={a}
                  className="rounded-full border border-border bg-card px-3 py-1 text-sm"
                >
                  {a}
                </span>
              ))}
              <span className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground">
                +more
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* It shows its work — sample play card */}
      <section className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-primary">
                It shows its work
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Every possession, explained to you.
              </h2>
            </div>
            <div className="scoreboard hidden text-sm text-muted-foreground md:block">
              Poss #14 · 0:18
            </div>
          </div>
          <div className="grid gap-6 rounded-xl border border-border bg-card p-6 md:grid-cols-[1fr_2fr]">
            <div className="relative overflow-hidden rounded-lg bg-black/40 court-grid">
              <div className="grid aspect-video place-items-center">
                <div className="text-center">
                  <Crosshair className="mx-auto h-8 w-8 text-primary" />
                  <div className="scoreboard mt-2 text-2xl font-semibold">You · #23</div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    tracked player
                  </div>
                </div>
              </div>
              <div className="absolute left-3 top-3 rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
                Missed jumper
              </div>
              <div className="absolute right-3 top-3 rounded bg-[color:var(--good)]/20 px-2 py-1 text-xs font-semibold text-[color:var(--good)]">
                High confidence
              </div>
            </div>
            <div className="space-y-4">
              <Row
                label="What happened"
                body="You came off the high ball-screen going left, the defender fought over the top, and you pulled up for a mid-range jumper that missed short."
              />
              <Row
                label="What you did well"
                tone="good"
                body="You read the coverage and used the screen cleanly — the switch was there and you got downhill on it."
              />
              <Row
                label="What to fix"
                tone="bad"
                body="The roll man's defender was late to tag the roll — there was a window to the rim you passed up for a contested pull-up."
              />
              <Row
                label="Do differently"
                tone="warn"
                body="Attack the rim off the switch, or hit the roller with a pocket pass — both beat that pull-up given how late the tag was."
              />
              <p className="pt-1 text-xs text-muted-foreground">
                Talks to you in second person, describes players by jersey — never by race — and if
                it didn&rsquo;t clearly see something, it says so instead of guessing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Two-up: fair to everyone + jumpshot lab */}
      <section className="border-t border-border/60">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-24 md:grid-cols-2">
          <Feature
            icon={Users}
            eyebrow="Fair to your role"
            title="You don't have to be the star to rate well."
            body="Not a ball hog? Good. PlayIQ grades you on what your role actually shows — lockdown defense, clean spacing, taking care of the ball, the little things — and never dings you for a job you didn't have. Glue guys and defenders get real credit and their own archetypes. And when the film's too thin to be sure, it says 'provisional' instead of faking a number."
          />
          <Feature
            icon={Crosshair}
            eyebrow="Jumpshot lab"
            title="A form check that only flags what's costing you makes."
            body="Upload a few reps and get a mechanics breakdown — thumb flick, low set point, off-balance base. Great shooters have wildly different forms, so it won't 'fix' a quirk that works; it only calls out what's genuinely hurting the shot, with a drill to clean it up."
          />
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="grid gap-6 sm:grid-cols-3">
            <TrustItem
              icon={ShieldCheck}
              title="The number is honest"
              body="The AI only counts what it sees; your rating is computed from those counts by code — not vibes. Same film, same number, every time."
            />
            <TrustItem
              icon={Gauge}
              title="It sharpens over time"
              body="Small sample? You stay near the middle until the film earns a move. More games, more certainty — your overall gets sharper as you feed it."
            />
            <TrustItem
              icon={Share2}
              title="Yours to share"
              body="Send any breakdown or your rating card with a link. Compare with the group chat. Bragging rights, backed by tape."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-balance">
            What would you be rated?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Upload a game today. Find out tonight.
          </p>
          <Button asChild size="lg" className="mt-8 gap-2">
            <Link to="/auth">
              Get your rating <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} PlayIQ · Your basketball rating, from real film
      </footer>
    </div>
  );
}

function RatingCardMock() {
  return (
    <div className="relative">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-primary/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-primary">Your rating</div>
            <div className="mt-1 text-lg font-semibold">You · #23 (black)</div>
            <span className="mt-2 inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium">
              Two-Way Wing
            </span>
          </div>
          <div className="text-right">
            <div className="scoreboard text-6xl font-bold leading-none tracking-tight text-primary">
              84
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
              Standout
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              overall
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {SUBSCORES.map(([label, value]) => (
            <SubBar key={label} label={label} value={value} />
          ))}
        </div>

        <p className="mt-6 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-[0.2em] text-foreground/80">
            Receipts ·{" "}
          </span>
          8/15 shooting · 1 turnover in 22 possessions · sits low and slides on D
        </p>
      </div>
      <div className="pointer-events-none absolute -bottom-6 -left-6 -z-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
    </div>
  );
}

function SubBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="scoreboard font-semibold">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${((value - 25) / 74) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  eyebrow,
  title,
  body,
}: {
  icon: typeof Users;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-5 text-xs uppercase tracking-[0.25em] text-primary">{eyebrow}</div>
      <h3 className="mt-2 text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function TrustItem({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}) {
  return (
    <div>
      <Icon className="h-6 w-6 text-primary" />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
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
