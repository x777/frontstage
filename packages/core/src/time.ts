export function secondsToFrame(seconds: number, fps: number): number {
  if (fps <= 0) return 0;
  return Math.trunc(seconds * fps);
}

export function frameToSeconds(frame: number, fps: number): number {
  if (fps <= 0) return 0;
  return frame / fps;
}

function twoDigit(value: number): string {
  return value >= 0 && value < 10 ? `0${value}` : `${value}`;
}

export function formatTimecode(frame: number, fps: number): string {
  if (fps <= 0) return "00:00:00:00";
  const abs = Math.abs(frame);
  const totalSeconds = Math.trunc(abs / fps);
  const ff = abs % fps;
  const ss = totalSeconds % 60;
  const mm = Math.trunc(totalSeconds / 60) % 60;
  const hh = Math.trunc(totalSeconds / 3600);
  const sign = frame < 0 ? "-" : "";
  return `${sign}${twoDigit(hh)}:${twoDigit(mm)}:${twoDigit(ss)}:${twoDigit(ff)}`;
}
