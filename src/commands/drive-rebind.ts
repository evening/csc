import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives } from '../db/schema';
import { resolveMount } from '../config';
import { readSentinel, SENTINEL_FILENAME } from '../sentinel';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

export async function driveRebind(args: Args): Promise<void> {
  const label = args.positional[0];
  if (!label) throw new Error('usage: csc drive rebind <label> --yes');
  if (args.flags.yes !== true) {
    throw new Error('refusing to rebind without --yes. this is a recovery hatch; use only when the sentinel is missing.');
  }
  const mountFlag = typeof args.flags.mount === 'string' ? args.flags.mount : undefined;
  const mount = resolveMount(label, mountFlag);

  const db = await openDb();
  const drv = (await db.select().from(drives).where(eq(drives.label, label)))[0];
  if (!drv) throw new Error(`unknown drive label: ${label}`);
  if (drv.driveUuid == null) {
    throw new Error(`drive "${label}" has no recorded uuid (never scanned). run 'csc scan ${label}' instead.`);
  }

  const existing = await readSentinel(mount);
  if (existing && existing.uuid !== drv.driveUuid) {
    throw new Error(
      `sentinel at ${mount} disagrees with the recorded uuid for ${label}.\n` +
      `  recorded: ${drv.driveUuid}\n` +
      `  found:    ${existing.uuid}\n` +
      `this is not a recovery case — it means the drive is not ${label}.`,
    );
  }
  if (existing && existing.uuid === drv.driveUuid) {
    console.log(`sentinel already matches; nothing to do.`);
    return;
  }

  const content = [
    `csc-drive-id: ${drv.driveUuid}`,
    `label-at-creation: ${label}`,
    `created: ${new Date().toISOString()}`,
    `note: cold storage catalog sentinel. do not delete. (rewritten by csc drive rebind)`,
    '',
  ].join('\n');
  await writeFile(join(mount, SENTINEL_FILENAME), content, 'utf8');
  console.log(`rebound ${label} sentinel to recorded uuid ${drv.driveUuid}`);
}
