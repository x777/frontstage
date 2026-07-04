// The generation facade's confirm-gate threshold (super-Swift — Swift has no numeric knob here,
// just a fixed rule). Persisted alongside the other host settings (agent/image model keys).
export const CONFIRM_THRESHOLD_STORAGE_KEY = "palmier.generation.confirmThreshold";
export const DEFAULT_CONFIRM_THRESHOLD = 50;

// Absent or invalid (non-finite / negative) stored value falls back to the default. Backs both the
// settings field's initial value and the generation facade's live-read confirmThreshold getter.
export function readConfirmThreshold(): number {
  const raw = localStorage.getItem(CONFIRM_THRESHOLD_STORAGE_KEY);
  if (raw === null) return DEFAULT_CONFIRM_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CONFIRM_THRESHOLD;
}

export function writeConfirmThreshold(value: number): void {
  localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, String(value));
}
