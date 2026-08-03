export class RealtimeEpochRotator {
  constructor({ currentEpoch, rotate }) {
    this.currentEpoch = currentEpoch;
    this.rotate = rotate;
    this.pendingEpoch = "";
    this.running = null;
  }

  request(epoch) {
    const nextEpoch = String(epoch || "");
    if (!nextEpoch || nextEpoch === this.currentEpoch()) return this.running || Promise.resolve();
    this.pendingEpoch = nextEpoch;
    if (!this.running) {
      this.running = this.#drain().finally(() => {
        this.running = null;
        if (this.pendingEpoch && this.pendingEpoch !== this.currentEpoch()) this.request(this.pendingEpoch);
      });
    }
    return this.running;
  }

  async #drain() {
    while (this.pendingEpoch && this.pendingEpoch !== this.currentEpoch()) {
      const targetEpoch = this.pendingEpoch;
      this.pendingEpoch = "";
      try {
        await this.rotate(targetEpoch);
      } catch (error) {
        if (this.pendingEpoch && this.pendingEpoch !== targetEpoch) continue;
        throw error;
      }
    }
  }
}
