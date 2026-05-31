import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { assertCmd } from '../../src/commands/assert';
import { check } from '../../src/commands/check';
import { driveAdd } from '../../src/commands/drive-add';
import { openDb } from '../../src/db/client';
import { locations } from '../../src/db/schema';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';

let workDir: string;
let nas: string;
let lines: string[] = [];

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  nas = join(workDir, 'nas');
  await writeTestFile(nas, '.keep', '');
  await driveAdd({ positional: ['hd5'], flags: {} });
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('assert', () => {
  it('refuses without --yes', async () => {
    await writeTestFile(nas, 'a.mkv', 'A');
    await expect(assertCmd({ positional: ['hd5', nas], flags: {} })).rejects.toThrow(/--yes/);
  });

  it('records asserted locations for files under the nas path', async () => {
    await writeTestFile(nas, 'a.mkv', 'A');
    await writeTestFile(nas, 'sub/b.mkv', 'B');
    await assertCmd({ positional: ['hd5', nas], flags: { yes: true } });
    const db = await openDb();
    const rows = await db.select().from(locations);
    expect(rows.length).toBe(3); // a.mkv, b.mkv, .keep
    expect(rows.every((r) => r.verification === 'asserted')).toBe(true);
  });

  it('check reports asserted-only files distinctly from scanned', async () => {
    await writeTestFile(nas, 'a.mkv', 'A');
    await assertCmd({ positional: ['hd5', nas], flags: { yes: true } });
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/⚠.*hd5.*asserted/);
  });
});
