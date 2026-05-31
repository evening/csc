import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveList } from '../../src/commands/drive-list';
import { driveAdd } from '../../src/commands/drive-add';
import { makeTmpDir, cleanup } from '../helpers';
import { join } from 'node:path';

let dir: string;
let lines: string[] = [];

beforeEach(async () => {
  dir = await makeTmpDir();
  process.env.CSC_DB = join(dir, 'catalog.db');
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(dir);
});

describe('drive list', () => {
  it('prints a header row even when no drives exist', async () => {
    await driveList({ positional: [], flags: {} });
    expect(lines.join('\n')).toMatch(/label/i);
  });

  it('lists added drives', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });
    await driveAdd({ positional: ['hd5'], flags: { notes: 'old' } });
    lines = []; // reset after add prints
    await driveList({ positional: [], flags: {} });
    const out = lines.join('\n');
    expect(out).toContain('hd3');
    expect(out).toContain('hd5');
  });
});
