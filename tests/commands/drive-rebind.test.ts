import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { driveRebind } from '../../src/commands/drive-rebind';
import { scan } from '../../src/commands/scan';
import { driveAdd } from '../../src/commands/drive-add';
import { readSentinel, writeSentinel } from '../../src/sentinel';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

let workDir: string;
let mount: string;

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  mount = join(workDir, 'mnt');
  await writeTestFile(mount, '.keep', '');
  await driveAdd({ positional: ['hd3'], flags: {} });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('drive rebind', () => {
  it('refuses without --yes', async () => {
    await expect(driveRebind({ positional: ['hd3'], flags: { mount } })).rejects.toThrow(/--yes/);
  });

  it('rewrites the sentinel from the recorded uuid when missing', async () => {
    await writeTestFile(mount, 'a.bin', 'a');
    await scan({ positional: ['hd3'], flags: { mount } });
    const before = await readSentinel(mount);
    await unlink(join(mount, '.csc-drive-id'));
    await driveRebind({ positional: ['hd3'], flags: { mount, yes: true } });
    const after = await readSentinel(mount);
    expect(after!.uuid).toBe(before!.uuid);
  });

  it('refuses when sentinel is present and disagrees', async () => {
    await writeTestFile(mount, 'a.bin', 'a');
    await scan({ positional: ['hd3'], flags: { mount } });
    await unlink(join(mount, '.csc-drive-id'));
    await writeSentinel(mount, 'hd3'); // fresh random uuid
    await expect(driveRebind({ positional: ['hd3'], flags: { mount, yes: true } }))
      .rejects.toThrow(/disagrees|mismatch/i);
  });

  it('refuses when the drive has no recorded uuid (never scanned)', async () => {
    await expect(driveRebind({ positional: ['hd3'], flags: { mount, yes: true } }))
      .rejects.toThrow(/never scanned|no recorded uuid/i);
  });
});
