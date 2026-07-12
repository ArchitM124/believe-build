import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guardrail for the share-link data-leak fix (migration 20260712000000).
 *
 * Anonymous visitors must read shared possessions ONLY through the
 * get_shared_possession RPC, which returns a single row with safe columns.
 * A direct `.from("plays")` read on the public share page would reopen the
 * hole where anyone could dump every user's data. If someone reverts to that,
 * these tests fail before it ships.
 */
const shareSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "share.$shareId.tsx"),
  "utf8",
);

test("public share page reads via the get_shared_possession RPC", () => {
  expect(shareSource).toContain("get_shared_possession");
});

test("public share page does NOT read the plays table directly", () => {
  expect(shareSource).not.toContain('.from("plays")');
  expect(shareSource).not.toContain(".from('plays')");
});
