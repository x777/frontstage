export const VOLUME_FLOOR_DB = -60;
export const VOLUME_CEILING_DB = 15;

export function dbFromLinear(linear: number): number {
  if (linear <= 0) return VOLUME_FLOOR_DB;
  return Math.min(VOLUME_CEILING_DB, Math.max(VOLUME_FLOOR_DB, 20 * Math.log10(linear)));
}

export function linearFromDb(db: number): number {
  if (db <= VOLUME_FLOOR_DB) return 0;
  return Math.pow(10, Math.min(db, VOLUME_CEILING_DB) / 20);
}
