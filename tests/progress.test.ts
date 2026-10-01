import { describe, it, expect } from 'bun:test';
import { Progress, progressEnabled } from '../src/progress';

describe('progressEnabled', () => {
  it('follows the terminal by default', () => {
    expect(progressEnabled({}, true)).toBe(true);
    expect(progressEnabled({}, false)).toBe(false);
  });
  it('--progress forces on, --no-progress forces off', () => {
    expect(progressEnabled({ progress: true }, false)).toBe(true);
    expect(progressEnabled({ 'no-progress': true }, true)).toBe(false);
  });
});

describe('Progress', () => {
  function make(enabled: boolean, tty: boolean) {
    const writes: string[] = [];
    let t = 0;
    const p = new Progress('scanning hd3', enabled, { tty, write: (s) => writes.push(s), now: () => t });
    return { p, writes, advance: (ms: number) => { t += ms; } };
  }

  it('formats files, bytes, rate and elapsed', () => {
    const { p, advance } = make(true, true);
    for (let i = 0; i < 12431; i++) p.file();
    p.hashed(10 * 1024 * 1024 * 1024);
    advance(3 * 3600_000 + 14 * 60_000 + 5_000);
    expect(p.line()).toBe('scanning hd3… 12,431 files, 10.0 GB hashed (900 KB/s), 03:14:05 elapsed');
    p.done();
  });

  it('redraws in place on a terminal and clears before stdout lines and on done', () => {
    const { p, writes } = make(true, true);
    p.file();
    p.render();
    expect(writes.at(-1)).toStartWith('\r\x1b[Kscanning hd3… 1 files');
    p.done();
    expect(writes.at(-1)).toBe('\r\x1b[K');
  });

  it('prints plain newline-terminated lines when forced on without a terminal', () => {
    const { p, writes } = make(true, false);
    p.render();
    expect(writes).toEqual(['scanning hd3… 0 files, 0 B hashed (–), 00:00:00 elapsed\n']);
    p.done();
    expect(writes.length).toBe(1);
  });

  it('writes nothing when disabled', () => {
    const { p, writes } = make(false, true);
    p.file();
    p.render();
    p.done();
    expect(writes).toEqual([]);
  });
});
