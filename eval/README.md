# Accuracy eval harness

A lab bench for measuring how accurate the AI possession analysis is. It runs
the exact two-pass pipeline the app uses (`src/lib/possession-analysis.core.ts`)
against clips whose real outcome you already know, so you can prove a change
made things better instead of just different. **It never touches the database
or the live app.**

## How to run

1. Drop clips into `eval/clips/` (each ≤20 MB, one possession — same limit as the app).
2. Copy the template and fill it in with the truth for each clip:
   ```
   cp eval/cases.example.json eval/cases.json
   ```
   For each clip set:
   - `video` — path under `eval/` (e.g. `clips/clip-1.mp4`)
   - `team_color`, `attack_direction` — what the uploader would enter
   - `truth` — one plain sentence of what actually happened
   - `expected_outcome` — one of: `made_shot`, `missed_shot`, `turnover`,
     `defensive_stop`, `defensive_breakdown`, `foul`, `other`
3. Put an AI key (or several) in `eval/.env`:
   ```
   GEMINI_API_KEY=...       # Google (aistudio.google.com/apikey)
   PERCEPTRON_API_KEY=...   # Perceptron Mk1 (platform.perceptron.inc)
   QWEN_API_KEY=...         # Alibaba Model Studio / DashScope
   LOVABLE_API_KEY=...      # the app's gateway key
   ```
   With several keys set, force one per run with `AI_PROVIDER=gemini|perceptron|qwen|lovable`
   (model override: `AI_MODEL=...`).
4. Run it:
   ```
   bun run eval/run-eval.ts
   ```
   (No bun? `npx tsx eval/run-eval.ts` works too.)

## Reading the output

- The final line is **outcome accuracy** (e.g. `8/10 (80%)`) — the objective score.
- For each clip it prints the AI's `said` line next to your `truth` line so you
  can judge whether the _specifics_ were right, not just the category.
- Everything is saved to `eval/results.<provider>.json` for a closer look.
- Ran the bench for several providers? `bun run eval/compare.ts` prints them side by side.

`clips/`, `cases.json`, and `results.json` are git-ignored — your footage and
answer key stay on your machine.
