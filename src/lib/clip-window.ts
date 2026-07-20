/**
 * The in-app game clipper cuts BACKWARD from the playhead: watch the game,
 * and when something just happened, clip the last N seconds.
 */
export function clipWindow(currentTime: number, lengthSec: number): { start: number; end: number } {
  const end = Math.max(0, currentTime);
  const start = Math.max(0, end - Math.max(1, lengthSec));
  return { start, end };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
