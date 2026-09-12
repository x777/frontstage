/** Palmier `TrackName.maximumLength`. */
export const TRACK_NAME_MAX_LENGTH = 80;

const CONTROL_OR_NEWLINE = /[\u0000-\u001F\u007F\u2028\u2029]/;

export type TrackNameNormalizeResult =
  | { ok: true; name: string | undefined }
  | { ok: false };

/**
 * Palmier `TrackName.normalized`: trim whitespace, reject control/newlines and names longer
 * than 80, empty (after trim) clears the user-authored name.
 */
export function normalizeTrackName(raw: string | null | undefined): TrackNameNormalizeResult {
  if (raw == null) return { ok: true, name: undefined };
  if (CONTROL_OR_NEWLINE.test(raw)) return { ok: false };
  const value = raw.trim();
  if (value.length > TRACK_NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, name: value.length === 0 ? undefined : value };
}
