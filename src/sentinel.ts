import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SENTINEL_FILENAME = '.csc-drive-id';

export interface Sentinel {
  uuid: string;
  labelAtCreation: string;
  created: string;
}

export async function readSentinel(mountPath: string): Promise<Sentinel | null> {
  const path = join(mountPath, SENTINEL_FILENAME);
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return parseSentinel(content);
}

export async function writeSentinel(mountPath: string, label: string): Promise<Sentinel> {
  const sentinel: Sentinel = {
    uuid: randomUUID(),
    labelAtCreation: label,
    created: new Date().toISOString(),
  };
  await writeFile(join(mountPath, SENTINEL_FILENAME), formatSentinel(sentinel), 'utf8');
  return sentinel;
}

function parseSentinel(content: string): Sentinel {
  const fields: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([a-z-]+):\s*(.*)$/);
    if (m) fields[m[1]!] = m[2]!.trim();
  }
  if (!fields['csc-drive-id']) {
    throw new Error('sentinel file missing csc-drive-id line');
  }
  return {
    uuid: fields['csc-drive-id'],
    labelAtCreation: fields['label-at-creation'] ?? '',
    created: fields['created'] ?? '',
  };
}

function formatSentinel(s: Sentinel): string {
  return [
    `csc-drive-id: ${s.uuid}`,
    `label-at-creation: ${s.labelAtCreation}`,
    `created: ${s.created}`,
    `note: cold storage catalog sentinel. do not delete.`,
    '',
  ].join('\n');
}
