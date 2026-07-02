export function nextPollDelay(prevMs: number | undefined): number {
  if (prevMs === undefined) return 2000;
  return Math.min(prevMs * 1.5, 10000);
}
