import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { scan } from '../../src/commands/scan';
import { check } from '../../src/commands/check';
import { whereis } from '../../src/commands/whereis';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

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

describe('integration: same content on multiple drives', () => {
  it('check shows ✓ with both drive labels when file is on both drives', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });
    await driveAdd({ positional: ['hd5'], flags: {} });

    const drive5 = join(workDir, 'drive5');
    await writeTestFile(drive5, '.keep', '');

    // Same content on NAS and both drives
    await writeTestFile(nas, 'movie.mkv', 'X');
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(drive5, 'movie.mkv', 'X');

    await scan({ positional: ['hd3'], flags: { mount: drive } });
    await scan({ positional: ['hd5'], flags: { mount: drive5 } });

    lines = [];
    await check({ positional: [nas], flags: {} });
    const out = lines.join('\n');
    expect(out).toContain('hd3');
    expect(out).toContain('hd5');
  });

  it('whereis lists both locations', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });
    await driveAdd({ positional: ['hd5'], flags: {} });

    const drive5 = join(workDir, 'drive5');
    await writeTestFile(drive5, '.keep', '');
    await writeTestFile(nas, 'movie.mkv', 'X');
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(drive5, 'movie.mkv', 'X');

    await scan({ positional: ['hd3'], flags: { mount: drive } });
    await scan({ positional: ['hd5'], flags: { mount: drive5 } });

    lines = [];
    await whereis({ positional: [join(nas, 'movie.mkv')], flags: {} });
    const out = lines.join('\n');
    expect(out).toContain('hd3 (scanned)');
    expect(out).toContain('hd5 (scanned)');
  });

  it('removing the file from one drive leaves it backed up on the other', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });
    await driveAdd({ positional: ['hd5'], flags: {} });

    const drive5 = join(workDir, 'drive5');
    await writeTestFile(drive5, '.keep', '');
    await writeTestFile(nas, 'movie.mkv', 'X');
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(drive5, 'movie.mkv', 'X');

    await scan({ positional: ['hd3'], flags: { mount: drive } });
    await scan({ positional: ['hd5'], flags: { mount: drive5 } });

    // Delete from hd5 and rescan
    await unlink(join(drive5, 'movie.mkv'));
    await scan({ positional: ['hd5'], flags: { mount: drive5 } });

    lines = [];
    await check({ positional: [nas], flags: {} });
    const out = lines.join('\n');
    expect(out).toMatch(/✓.*movie\.mkv/);
    expect(out).toContain('hd3'); // still on hd3
    expect(out).not.toMatch(/movie\.mkv.*hd5/); // not on hd5 anymore
  });
});
