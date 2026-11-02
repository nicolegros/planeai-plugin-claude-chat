/** One clock for every elapsed time on screen; it ticks only while one is shown. */
class Clock {
  now = $state(Date.now());
  private holders = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Keeps the clock ticking; call from an `$effect` and return the release it gives. */
  hold(): () => void {
    if (this.holders++ === 0) {
      this.now = Date.now();
      this.timer = setInterval(() => (this.now = Date.now()), 1000);
    }
    return () => {
      if (--this.holders === 0) clearInterval(this.timer);
    };
  }
}

export const clock = new Clock();
