import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { ls } from '../../src/commands/ls';
import { scan } from '../../src/commands/scan';
import { assertCmd } from '../../src/commands/assert';
import { driveAdd } from '../../src/commands/drive-add';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';

let workDir: string;
let hd3: string;
let hd5: string;
let lines: string[] = [];

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  hd3 = join(workDir, 'hd3');
  hd5 = join(workDir, 'hd5');
  await writeTestFile(hd3, 'music_archive/a.flac', 'aaaa');
  await writeTestFile(hd3, 'music-archive/b.flac', 'bb');
  await writeTestFile(hd3, 'movies/c.mkv', 'c');
  await writeTestFile(hd5, 'other.mkv', 'other');
  await driveAdd({ positional: ['hd3'], flags: {} });
  await driveAdd({ positional: ['hd5'], flags: {} });
  await scan({ positional: ['hd3'], flags: { mount: hd3 } });
  await scan({ positional: ['hd5'], flags: { mount: hd5 } });
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('ls', () => {
  it('lists only the target drive, sorted, with a total', async () => {
    await ls({ positional: ['hd3'], flags: {} });
    expect(lines.slice(0, -1).map((l) => l.split(/\s+/)[0])).toEqual([
      'movies/c.mkv', 'music-archive/b.flac', 'music_archive/a.flac',
    ]);
    expect(lines.join('\n')).not.toContain('other.mkv');
    expect(lines.at(-1)).toBe('3 files, 7 B');
  });

  it('subpath filter is an exact prefix (underscore is not a wildcard)', async () => {
    await ls({ positional: ['hd3', 'music_archive/'], flags: {} });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith('music_archive/a.flac');
    expect(lines[1]).toBe('1 files, 4 B');
  });

  it('marks asserted locations', async () => {
    const nas = join(workDir, 'nas');
    await writeTestFile(nas, 'claimed.mkv', 'claimed');
    await assertCmd({ positional: ['hd5', nas], flags: { yes: true } });
    lines = [];
    await ls({ positional: ['hd5'], flags: {} });
    expect(lines.find((l) => l.startsWith('claimed.mkv'))).toContain('(asserted)');
    expect(lines.find((l) => l.startsWith('other.mkv'))).not.toContain('(asserted)');
  });

  it('empty result and unknown label', async () => {
    await ls({ positional: ['hd3', 'nope'], flags: {} });
    expect(lines).toEqual(['0 files, 0 B']);
    await expect(ls({ positional: ['hd9'], flags: {} })).rejects.toThrow(/unknown drive label/);
  });
});
