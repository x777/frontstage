import {
  CONFIRM_THRESHOLD_STORAGE_KEY,
  DEFAULT_CONFIRM_THRESHOLD,
  readConfirmThreshold,
  writeConfirmThreshold,
} from "../src/agent/generation-settings.js";

beforeEach(() => {
  localStorage.clear();
});

test("readConfirmThreshold: defaults to 50 when nothing is stored", () => {
  expect(readConfirmThreshold()).toBe(50);
  expect(DEFAULT_CONFIRM_THRESHOLD).toBe(50);
});

test("readConfirmThreshold: an invalid (non-numeric) stored value falls back to 50", () => {
  localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, "not-a-number");
  expect(readConfirmThreshold()).toBe(50);
});

test("readConfirmThreshold: a negative stored value falls back to 50", () => {
  localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, "-5");
  expect(readConfirmThreshold()).toBe(50);
});

test("readConfirmThreshold: a valid stored value round-trips", () => {
  localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, "10");
  expect(readConfirmThreshold()).toBe(10);
});

test("readConfirmThreshold: 0 is a valid stored value (always ask)", () => {
  localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, "0");
  expect(readConfirmThreshold()).toBe(0);
});

test("writeConfirmThreshold persists so a later readConfirmThreshold sees it", () => {
  writeConfirmThreshold(25);
  expect(readConfirmThreshold()).toBe(25);
  expect(localStorage.getItem(CONFIRM_THRESHOLD_STORAGE_KEY)).toBe("25");
});

// Mirrors both hosts' generation facade wiring: confirmThreshold is a live getter, not a snapshot,
// so a Settings change is picked up by the very next tool call without recreating the facade.
test("a getter-based facade (the hosts' wiring shape) reflects a Settings change immediately", () => {
  const facade = {
    get confirmThreshold() {
      return readConfirmThreshold();
    },
  };
  expect(facade.confirmThreshold).toBe(DEFAULT_CONFIRM_THRESHOLD);

  writeConfirmThreshold(0);
  expect(facade.confirmThreshold).toBe(0);

  writeConfirmThreshold(200);
  expect(facade.confirmThreshold).toBe(200);
});
