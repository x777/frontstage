export class PlayClock {
  private startMs = 0;
  private fromFrame = 0;
  private running = false;
  constructor(private fps: number, private now: () => number = () => performance.now()) {}
  start(fromFrame: number): void { this.fromFrame = fromFrame; this.startMs = this.now(); this.running = true; }
  pause(): void { this.fromFrame = this.frame; this.running = false; }
  get frame(): number { return this.running ? this.fromFrame + ((this.now() - this.startMs) / 1000) * this.fps : this.fromFrame; }
}
