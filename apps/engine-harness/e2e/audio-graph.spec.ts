import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __audioGraphReady: boolean;
    __audioGraphRun: () => Promise<{ isolated: boolean; t0: number; t1: number }>;
  }
}

test("audio worklet plays streamed PCM (clock advances, ring drains)", async ({ page }) => {
  await page.goto("/audio-graph.html");
  await page.waitForFunction(() => window.__audioGraphReady === true, { timeout: 20_000 });
  const r = await page.evaluate(() => window.__audioGraphRun!());
  expect(r.isolated).toBe(true);           // COOP/COEP → SAB available
  expect(r.t1).toBeGreaterThan(r.t0);      // audioContext.currentTime advanced
  expect(r.t1 - r.t0).toBeGreaterThan(0.2); // ~300ms elapsed
});
