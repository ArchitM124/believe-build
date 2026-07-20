import { test, expect } from "bun:test";
import { clipWindow, formatClock } from "./clip-window";

test("clipWindow cuts backward from the playhead", () => {
  expect(clipWindow(60, 8)).toEqual({ start: 52, end: 60 });
});

test("clipWindow clamps at the start of the video", () => {
  expect(clipWindow(5, 8)).toEqual({ start: 0, end: 5 });
  expect(clipWindow(0, 8)).toEqual({ start: 0, end: 0 });
});

test("clipWindow guards degenerate lengths", () => {
  expect(clipWindow(30, 0).start).toBe(29); // min 1s window
});

test("formatClock renders m:ss", () => {
  expect(formatClock(0)).toBe("0:00");
  expect(formatClock(65)).toBe("1:05");
  expect(formatClock(754.9)).toBe("12:34");
});
