import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives } from '../db/schema';

export async function driveAdd(args: Args): Promise<void> {
  const label = args.positional[0];
  if (!label) throw new Error('label required: csc drive add <label>');
  const notes = typeof args.flags.notes === 'string' ? args.flags.notes : null;
  const db = await openDb();
  await db.insert(drives).values({ label, notes }).execute();
  console.log(`added drive ${label}`);
}
