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
3. Use the same AI key the app uses:
   ```
   export LOVABLE_API_KEY=...
   ```
4. Run it:
   ```
   bun run eval/run-eval.ts
   ```
   (No bun? `npx tsx eval/run-eval.ts` works too.)

## Reading the output

- The final line is **outcome accuracy** (e.g. `8/10 (80%)`) — the objective score.
- For each clip it prints the AI's `said` line next to your `truth` line so you
  can judge whether the _specifics_ were right, not just the category.
- Everything is saved to `eval/results.json` for a closer look.

`clips/`, `cases.json`, and `results.json` are git-ignored — your footage and
answer key stay on your machine.
