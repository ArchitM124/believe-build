/**
 * How long a possession may sit in 'processing'/'uploading' before it is
 * treated as genuinely stalled (e.g. the tab was closed mid-run).
 *
 * Two things key off this and MUST agree:
 *  - the client self-heal restarts a clip only after it has been stuck this long;
 *  - the server function refuses to start a second run for a possession already
 *    'processing' that was touched more recently than this.
 *
 * It must comfortably exceed a real two-pass Gemini video analysis so a healthy,
 * still-running job is never duplicated (which would double-spend AI credits and
 * let a slow/failed duplicate overwrite a good result).
 */
export const STALE_AFTER_MS = 8 * 60 * 1000; // 8 minutes
