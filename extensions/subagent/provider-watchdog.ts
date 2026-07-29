export class ProviderIdleWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private readonly timeoutMs: number;
  private readonly onTimeout: () => void;

  constructor(timeoutMs: number, onTimeout: () => void) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
  }

  start(): void {
    this.active = true;
    this.schedule();
  }

  touch(): void {
    if (this.active) this.schedule();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.active = false;
      this.onTimeout();
    }, this.timeoutMs);
  }
}
