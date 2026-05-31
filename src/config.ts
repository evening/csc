import { homedir } from 'node:os';
import { join } from 'node:path';

export function dbPath(): string {
  return process.env.CSC_DB ?? join(homedir(), '.csc', 'catalog.db');
}

export function resolveMount(label: string, mountFlag: string | undefined): string {
  if (mountFlag) return mountFlag;
  const envKey = `CSC_MOUNT_${label.toUpperCase().replaceAll('-', '_')}`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  throw new Error(
    `mount path for drive "${label}" is not set. pass --mount <path> or set ${envKey}=<path>.`,
  );
}
