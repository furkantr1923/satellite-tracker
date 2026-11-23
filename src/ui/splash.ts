/** NASA tarzı kısa açılış ekranı. En az MIN_MS görünür, sonra yumuşakça kaybolur. */
const MIN_MS = 1600;

export class Splash {
  private readonly started = performance.now();
  private readonly el = document.getElementById('splash');
  private readonly step = document.getElementById('splash-step');

  setStep(text: string): void {
    if (this.step) this.step.textContent = text;
  }

  async done(): Promise<void> {
    const wait = MIN_MS - (performance.now() - this.started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.el?.classList.add('done');
    setTimeout(() => this.el?.remove(), 700);
  }
}
