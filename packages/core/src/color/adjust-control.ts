const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function sliderFrac(value: number, min: number, max: number): number {
  return max === min ? 0 : clamp01((value - min) / (max - min));
}
export function sliderValue(frac: number, min: number, max: number): number {
  return min + clamp01(frac) * (max - min);
}
export function scrubDelta(dx: number, min: number, max: number, mods: { shift?: boolean; meta?: boolean }): number {
  const base = ((max - min) / 200) * dx;
  return base * (mods.shift ? 10 : mods.meta ? 0.1 : 1);
}
export function formatParam(value: number, min: number, max: number): string {
  return (max - min) <= 20 ? value.toFixed(2) : value.toFixed(0);
}
