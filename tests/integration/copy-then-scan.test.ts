import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { scan } from '../../src/commands/scan';
import { check } from '../../src/commands/check';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';

let workDir: string;
let drive: string;
let nas: string;
let lines: string[] = [];

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  drive = join(workDir, 'drive');
  nas = join(workDir, 'nas');
  await writeTestFile(drive, '.keep', '');
  await writeTestFile(nas, '.keep', '');
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});

afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('integration: copy then scan is the standard backup flow', () => {
  it('orphan becomes backed up after copy + scan', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });

    // Step 1: file exists only on NAS
    await writeTestFile(nas, 'movie.mkv', 'movie content');

    // Step 2: check reports it as ✗ not backed up
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/✗.*movie\.mkv.*not backed up/);

    // Step 3: user copies file to drive (simulating rsync)
    await writeTestFile(drive, 'movie.mkv', 'movie content');

    // Step 4: scan the drive
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    // Step 5: check now reports ✓
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/✓.*movie\.mkv.*hd3/);
  });

  it('check summary mode tracks the orphan → backed-up transition', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });
    await writeTestFile(nas, 'a.bin', 'one');
    await writeTestFile(nas, 'b.bin', 'two');

    // Before any backup (nas also has .keep from setup, so 3 files total)
    lines = [];
    await check({ positional: [nas], flags: { summary: true } });
    // 3 files: a.bin, b.bin, .keep — none backed up
    expect(lines.join('\n')).toMatch(/3 files, 0 backed up.*3 not backed up/);

    // Copy one of them to the drive and scan
    await writeTestFile(drive, 'a.bin', 'one');
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    lines = [];
    await check({ positional: [nas], flags: { summary: true } });
    // After scan: a.bin + .keep are backed up (both on drive), b.bin is not
    expect(lines.join('\n')).toMatch(/3 files, 2 backed up.*1 not backed up/);
  });
});
