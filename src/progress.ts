import { fmtBytes } from './format';

// Live progress goes to stderr so stdout stays clean for piping.
// On a terminal the line redraws in place once a second; when forced on for a
// non-terminal (e.g. logging a long run to a file) it prints a plain line every
// 30 seconds instead.

export function progressEnabled(flags: Record<string, string | boolean>, isTTY = process.stderr.isTTY === true): boolean {
  if (flags['no-progress'] === true) return false;
  if (flags.progress === true) return true;
  return isTTY;
}

interface ProgressOptions {
  tty?: boolean;
  write?: (s: string) => void;
  now?: () => number;
}

export class Progress {
  private files = 0;
  private bytes = 0;
  private drawn = false;
  private readonly start: number;
  private readonly tty: boolean;
  private readonly write: (s: string) => void;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly verb: string, private readonly enabled: boolean, opts: ProgressOptions = {}) {
    this.tty = opts.tty ?? process.stderr.isTTY === true;
    this.write = opts.write ?? ((s) => { process.stderr.write(s); });
    this.now = opts.now ?? Date.now;
    this.start = this.now();
    if (enabled) {
      this.timer = setInterval(() => this.render(), this.tty ? 1000 : 30_000);
      this.timer.unref?.();
    }
  }

  file(): void { this.files++; }
  hashed(n: number): void { this.bytes += n; }

  line(): string {
    const secs = Math.max(0, Math.floor((this.now() - this.start) / 1000));
    const rate = secs > 0 ? `${fmtBytes(Math.round(this.bytes / secs))}/s` : '–';
    return `${this.verb}… ${this.files.toLocaleString('en-US')} files, ${fmtBytes(this.bytes)} hashed (${rate}), ${fmtElapsed(secs)} elapsed`;
  }

  render(): void {
    if (!this.enabled) return;
    if (this.tty) {
      this.write(`\r\x1b[K${this.line()}`);
      this.drawn = true;
    } else {
      this.write(`${this.line()}\n`);
    }
  }

  // Print a stdout line without it colliding with the in-place progress line.
  log(s: string): void {
    this.clear();
    console.log(s);
  }

  done(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clear();
  }

  private clear(): void {
    if (this.drawn) {
      this.write('\r\x1b[K');
      this.drawn = false;
    }
  }
}

function fmtElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
