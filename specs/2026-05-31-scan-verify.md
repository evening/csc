# `scan --verify` (byte-level re-read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `csc scan --verify` flag that re-reads every file's bytes (bypassing the metadata-based resume skip), reports any file whose content changed since it was last cataloged, and records when each location was last byte-verified.

**Architecture:** Today `scan` skips re-hashing a file when its `(path, size, mtime)` matches what's recorded (`src/commands/scan.ts:78`) — a resume optimization that also means silent bitrot (bytes change, size+mtime don't) is never detected on rescan. We add a `verified_at` column to `locations` and a `--verify` flag that (a) always re-hashes, (b) compares the fresh hash to the recorded content hash and prints a loud line on mismatch, and (c) stamps `verified_at`. Normal scans are unchanged and remain fast.

**Tech Stack:** Bun + TypeScript, `bun:sqlite` via Drizzle ORM, drizzle-kit migrations, `bun:test`. xxh3 hashing via `src/hash.ts`.

**Out of scope (deliberately, YAGNI):** cross-invocation resume of an interrupted `--verify` pass, and a `--since`/scrub policy. The `verified_at` column added here is the enabling groundwork for both, but neither is built now. A `--verify` run re-reads the whole drive every time; this is documented in Task 4.

---

## File Structure

- `src/db/schema.ts` — add `verified_at` column to the `locations` table (the only schema change).
- `drizzle/00xx_*.sql` + `drizzle/meta/*` — generated migration (do not hand-edit; produced by `bun run db:generate`).
- `src/commands/scan.ts` — add the `--verify` branch: bypass the skip, detect+report content mismatches, stamp `verified_at`, and adjust the final summary line.
- `src/cli.ts` — update the `USAGE` string only (the `scan` dispatch already forwards all flags, so no dispatch change is needed).
- `tests/commands/scan.test.ts` — new tests for the `--verify` behavior and `verified_at` semantics.
- `README.md` — document `--verify` and fix two now-inaccurate claims (the "scan reads bytes, always" design rule and the bitrot paragraph).

---

## Task 1: Add the `verified_at` column + migration

**Files:**
- Modify: `src/db/schema.ts:35-36`
- Generate: `drizzle/00xx_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/00xx_snapshot.json`

- [ ] **Step 1: Add the column to the `locations` table**

In `src/db/schema.ts`, the `locations` table currently ends like this:

```ts
    verification: text('verification', { enum: ['scanned', 'asserted'] }).notNull(),
    mtime: integer('mtime'), // epoch seconds, null for asserted rows
    recordedAt: text('recorded_at').notNull(),
  },
```

Change it to add `verifiedAt`:

```ts
    verification: text('verification', { enum: ['scanned', 'asserted'] }).notNull(),
    mtime: integer('mtime'), // epoch seconds, null for asserted rows
    recordedAt: text('recorded_at').notNull(),
    verifiedAt: text('verified_at'), // ISO ts of last byte-level read; null = never byte-verified
  },
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: drizzle-kit prints that it created a new migration (e.g. `drizzle/0001_<random_name>.sql`) containing `ALTER TABLE \`locations\` ADD \`verified_at\` text;`, and updates `drizzle/meta/_journal.json` + a new snapshot. Adding a nullable column requires no table rebuild.

- [ ] **Step 3: Confirm the migration applies and nothing breaks**

Run: `bun test tests/commands/scan.test.ts`
Expected: PASS. `openDb()` runs `migrate()` on every open (`src/db/client.ts:18`), so the new column is applied to fresh test DBs automatically. The column is nullable and unused by code so far, so all existing assertions still hold.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors from the new field).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add locations.verified_at column for byte-level verification"
```

---

## Task 2: `--verify` bypasses the skip and stamps `verified_at`

This task makes `--verify` always re-hash, and makes every byte-read path stamp `verified_at`. Mismatch reporting is added in Task 3.

**Files:**
- Modify: `src/commands/scan.ts` (flag parse near line 16; skip logic lines 61-81; location upsert lines 108-139; summary line 175)
- Test: `tests/commands/scan.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these imports at the top of `tests/commands/scan.test.ts` (alongside the existing `node:fs/promises` import, which already brings in `unlink, utimes`):

```ts
import { files } from '../../src/db/schema';
import { stat } from 'node:fs/promises';
```

Note: `files` must be added to the existing `import { drives, files, locations } from '../../src/db/schema';` line if not already present — it is. Add `stat` to the `node:fs/promises` import line so it reads:
`import { unlink, utimes, stat } from 'node:fs/promises';`

Then add these tests inside the `describe('scan', ...)` block:

```ts
// Helper: read the content hash currently associated with a path on the drive.
async function hashAtPath(path: string): Promise<string | undefined> {
  const db = await openDb();
  const row = (await db
    .select({ x: files.xxh3 })
    .from(locations)
    .innerJoin(files, eq(files.id, locations.fileId))
    .where(eq(locations.pathOnDrive, path)))[0];
  return row?.x;
}

it('normal scan SKIPS a same-size, same-mtime content change (documents the gap)', async () => {
  const p = await writeTestFile(mount, 'a.bin', 'aaaa');
  const fixed = new Date('2020-01-01T00:00:00Z');
  await utimes(p, fixed, fixed);
  await scan({ positional: ['hd3'], flags: { mount } });
  const before = await hashAtPath('a.bin');

  // overwrite with different content of identical length, restore mtime
  await Bun.write(p, 'bbbb');
  await utimes(p, fixed, fixed);
  await scan({ positional: ['hd3'], flags: { mount } }); // no --verify

  // because (size, mtime) are unchanged, the skip fires and the stale hash remains
  expect(await hashAtPath('a.bin')).toBe(before);
});

it('--verify catches a same-size, same-mtime content change', async () => {
  const p = await writeTestFile(mount, 'a.bin', 'aaaa');
  const fixed = new Date('2020-01-01T00:00:00Z');
  await utimes(p, fixed, fixed);
  await scan({ positional: ['hd3'], flags: { mount } });
  const before = await hashAtPath('a.bin');

  await Bun.write(p, 'bbbb');
  await utimes(p, fixed, fixed);
  await scan({ positional: ['hd3'], flags: { mount, verify: true } });

  // --verify re-read the bytes and re-pointed the location to the new content
  const after = await hashAtPath('a.bin');
  expect(after).not.toBe(before);
});

it('first scan stamps verified_at; a metadata-skip rescan leaves it unchanged', async () => {
  await writeTestFile(mount, 'a.bin', 'a');
  await scan({ positional: ['hd3'], flags: { mount } });
  const db = await openDb();
  const v1 = (await db.select().from(locations).where(eq(locations.pathOnDrive, 'a.bin')))[0]!.verifiedAt;
  expect(v1).not.toBeNull();

  await scan({ positional: ['hd3'], flags: { mount } }); // unchanged → skip path
  const v2 = (await db.select().from(locations).where(eq(locations.pathOnDrive, 'a.bin')))[0]!.verifiedAt;
  expect(v2).toBe(v1); // skip did not re-read bytes, so the timestamp is untouched
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/commands/scan.test.ts -t verify` and `bun test tests/commands/scan.test.ts -t verified_at`
Expected: FAIL. The `--verify` test fails because `verify: true` is ignored today (skip still fires, hash unchanged). The `verified_at` test fails because `verifiedAt` is never written (it is `null`).

- [ ] **Step 3: Parse the `--verify` flag**

In `src/commands/scan.ts`, just after the `mount` is resolved (currently line 17), add:

```ts
  const verify = args.flags.verify === true;
```

- [ ] **Step 4: Add a mismatch counter alongside the other counters**

Currently near line 53-54:

```ts
  const now = () => new Date().toISOString();
  const seenLocationIds = new Set<number>();
```

Change to:

```ts
  const now = () => new Date().toISOString();
  const seenLocationIds = new Set<number>();
  let mismatches = 0;
```

- [ ] **Step 5: Fetch the old content hash and gate the skip on `!verify`**

Replace the existing lookup + skip block (currently `src/commands/scan.ts:63-81`):

```ts
    const existing = (await db
      .select({
        locId: locations.id,
        fileId: locations.fileId,
        mtime: locations.mtime,
        fileSize: files.sizeBytes,
      })
      .from(locations)
      .innerJoin(files, eq(files.id, locations.fileId))
      .where(and(
        eq(locations.driveId, driveRow.id),
        eq(locations.pathOnDrive, pathOnDrive),
        eq(locations.verification, 'scanned'),
      )))[0];

    if (existing && existing.fileSize === entry.sizeBytes && existing.mtime === entry.mtime) {
      seenLocationIds.add(existing.locId);
      continue;
    }

    // Hash the file (must happen outside the sync transaction)
    const xxh3 = await hashFile(entry.absolutePath);
```

with this (adds `fileXxh3` to the select, gates the skip on `!verify`):

```ts
    const existing = (await db
      .select({
        locId: locations.id,
        fileId: locations.fileId,
        mtime: locations.mtime,
        fileSize: files.sizeBytes,
        fileXxh3: files.xxh3,
      })
      .from(locations)
      .innerJoin(files, eq(files.id, locations.fileId))
      .where(and(
        eq(locations.driveId, driveRow.id),
        eq(locations.pathOnDrive, pathOnDrive),
        eq(locations.verification, 'scanned'),
      )))[0];

    // Normal mode: skip re-hashing when (size, mtime) are unchanged (resume optimization).
    // --verify mode: never skip — always re-read bytes to catch silent content changes (bitrot).
    if (!verify && existing && existing.fileSize === entry.sizeBytes && existing.mtime === entry.mtime) {
      seenLocationIds.add(existing.locId);
      continue;
    }

    // Hash the file (must happen outside the sync transaction)
    const xxh3 = await hashFile(entry.absolutePath);
```

- [ ] **Step 6: Stamp `verified_at` on both the insert and update of the location**

In the transaction, the location update branch (currently `src/commands/scan.ts:117-120`):

```ts
        tx.update(locations)
          .set({ pathOnDrive, verification: 'scanned', mtime: entry.mtime, recordedAt: now() })
          .where(eq(locations.id, existingLoc.id))
          .run();
```

becomes:

```ts
        tx.update(locations)
          .set({ pathOnDrive, verification: 'scanned', mtime: entry.mtime, recordedAt: now(), verifiedAt: now() })
          .where(eq(locations.id, existingLoc.id))
          .run();
```

And the location insert branch (currently `src/commands/scan.ts:123-134`):

```ts
        const insLoc = tx
          .insert(locations)
          .values({
            fileId,
            driveId: driveRow.id,
            pathOnDrive,
            verification: 'scanned',
            mtime: entry.mtime,
            recordedAt: now(),
          })
          .returning()
          .all()[0];
```

becomes (adds `verifiedAt`):

```ts
        const insLoc = tx
          .insert(locations)
          .values({
            fileId,
            driveId: driveRow.id,
            pathOnDrive,
            verification: 'scanned',
            mtime: entry.mtime,
            recordedAt: now(),
            verifiedAt: now(),
          })
          .returning()
          .all()[0];
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/commands/scan.test.ts`
Expected: PASS — including the three new tests and all pre-existing ones. (The mismatch-reporting test is added in Task 3; `mismatches` is incremented there.)

- [ ] **Step 8: Commit**

```bash
git add src/commands/scan.ts tests/commands/scan.test.ts
git commit -m "feat(scan): --verify re-reads bytes and stamps verified_at"
```

---

## Task 3: Report content mismatches loudly + summary line

**Files:**
- Modify: `src/commands/scan.ts` (after the hash, near the code added in Task 2 Step 5; and the final summary line ~175)
- Test: `tests/commands/scan.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('scan', ...)` block in `tests/commands/scan.test.ts`:

```ts
it('--verify prints a loud line and counts a mismatch when content changed', async () => {
  const p = await writeTestFile(mount, 'a.bin', 'aaaa');
  const fixed = new Date('2020-01-01T00:00:00Z');
  await utimes(p, fixed, fixed);
  await scan({ positional: ['hd3'], flags: { mount } });

  await Bun.write(p, 'bbbb');
  await utimes(p, fixed, fixed);

  // capture console output for the verify run
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    await scan({ positional: ['hd3'], flags: { mount, verify: true } });
  } finally {
    console.log = orig;
  }

  expect(logs.some((l) => l.includes('content changed') && l.includes('a.bin'))).toBe(true);
  expect(logs.some((l) => /1 mismatches/.test(l))).toBe(true);
});

it('--verify on unchanged content reports zero mismatches', async () => {
  await writeTestFile(mount, 'a.bin', 'a');
  await scan({ positional: ['hd3'], flags: { mount } });

  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    await scan({ positional: ['hd3'], flags: { mount, verify: true } });
  } finally {
    console.log = orig;
  }

  expect(logs.some((l) => l.includes('content changed'))).toBe(false);
  expect(logs.some((l) => /0 mismatches/.test(l))).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/commands/scan.test.ts -t mismatch`
Expected: FAIL — no `content changed` line is printed and the summary line is still the `scanned drive ...` form without a mismatch count.

- [ ] **Step 3: Emit the mismatch line after hashing**

In `src/commands/scan.ts`, immediately after the `const xxh3 = await hashFile(entry.absolutePath);` line (added/kept in Task 2 Step 5) and before the `db.transaction(...)` call, insert:

```ts
    // --verify: the bytes were re-read. If they differ from what the catalog recorded
    // for this path, surface it loudly — this is the silent-rot / unexpected-change signal.
    if (verify && existing && (existing.fileXxh3 !== xxh3 || existing.fileSize !== entry.sizeBytes)) {
      mismatches++;
      console.log(
        `⚠ content changed on ${label}: ${pathOnDrive}\n` +
        `    recorded ${existing.fileXxh3} (${existing.fileSize} B), now ${xxh3} (${entry.sizeBytes} B)`,
      );
    }
```

- [ ] **Step 4: Branch the summary line on `verify`**

Replace the final summary line (currently `src/commands/scan.ts:175`):

```ts
  console.log(`scanned drive ${label} (${seenLocationIds.size} files, pruned ${toPrune.length})`);
```

with:

```ts
  if (verify) {
    console.log(`verified drive ${label} (${seenLocationIds.size} files, ${mismatches} mismatches, pruned ${toPrune.length})`);
  } else {
    console.log(`scanned drive ${label} (${seenLocationIds.size} files, pruned ${toPrune.length})`);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/commands/scan.test.ts`
Expected: PASS — all scan tests including the two new mismatch tests.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS across the whole suite (no regressions in integration tests).

- [ ] **Step 7: Commit**

```bash
git add src/commands/scan.ts tests/commands/scan.test.ts
git commit -m "feat(scan): report content mismatches and a verified summary line"
```

---

## Task 4: Wire usage text + reconcile the docs

The README currently makes two claims that this feature contradicts; fix them and document `--verify`.

**Files:**
- Modify: `src/cli.ts:10`
- Modify: `README.md` (three passages, quoted below)

- [ ] **Step 1: Update the `USAGE` string**

In `src/cli.ts`, the scan usage line (line 10):

```ts
  csc scan <label> [path] [--mount <path>]
```

becomes:

```ts
  csc scan <label> [path] [--mount <path>] [--verify]
```

- [ ] **Step 2: Document `--verify` in the README scan section**

In `README.md`, find the end of the "Scan a drive (the workhorse)" section — right after the subtree example block:

```
csc scan hd3 movies --mount /Volumes/hd3
```

Add a new paragraph immediately after that fenced block:

```markdown

By default, scan skips files whose `(path, size, mtime)` are unchanged — that's what makes re-scanning fast. To force a full byte-level re-read (e.g. a periodic integrity pass), use `--verify`:

```bash
csc scan hd3 --verify --mount /Volumes/hd3
```

`--verify` re-hashes every file regardless of size/mtime and prints a `⚠ content changed` line for any file whose bytes no longer match what the catalog recorded — the signal you'd want for silent bitrot. It reads the whole drive, so it's as slow as a first scan; run it occasionally, not every time.
```

- [ ] **Step 3: Fix the bitrot claim in "What it deliberately doesn't do"**

In `README.md`, the integrity-verifier bullet currently reads:

```markdown
- **An integrity verifier.** xxh3 detects "different bytes" but doesn't promise bitrot freedom. A drive that silently rots will eventually produce different hashes on rescan; that's detection-by-accident, not a verification feature.
```

Replace it with:

```markdown
- **An integrity verifier.** xxh3 detects "different bytes" but doesn't promise bitrot freedom. An ordinary rescan skips files whose `(path, size, mtime)` are unchanged, so silent rot (bytes change, metadata doesn't) is *not* caught by default — run `csc scan --verify` to force a byte-level re-read that flags changed content. Even then this is detection, not prevention.
```

- [ ] **Step 4: Fix the "scan reads bytes, always" design rule**

In `README.md`, under "Design rules to keep in mind", the rule currently reads:

```markdown
- **scan reads bytes, always.** Don't add an mtime shortcut to scan. The NAS cache is the only mtime shortcut allowed.
```

Replace it with:

```markdown
- **scan reads bytes by default; `--verify` guarantees it.** A plain scan uses a `(path, size, mtime)` resume skip so re-scans are fast. That skip cannot catch a content change that preserves size and mtime — `csc scan --verify` exists for that and must always re-hash. Don't add further metadata shortcuts to the `--verify` path.
```

- [ ] **Step 5: Verify docs reference real behavior**

Run: `bun run csc scan --help` (prints USAGE) and confirm the `[--verify]` flag appears.
Expected: the usage block lists `csc scan <label> [path] [--mount <path>] [--verify]`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts README.md
git commit -m "docs(scan): document --verify and reconcile bitrot/byte-read claims"
```

---

## Self-Review notes

- **Spec coverage:** flag parsing (T2-S3), skip bypass (T2-S5), `verified_at` column (T1) + stamping (T2-S6), mismatch detection/reporting (T3-S3), summary line (T3-S4), usage + docs reconciliation (T4). All implications from the design discussion that are *in scope* are covered.
- **Out-of-scope, intentionally:** interrupted-`--verify` resume and a `--since`/scrub policy. `verified_at` is added as their foundation but neither is implemented (YAGNI). Documented at the top and in T4-S2 ("reads the whole drive ... run it occasionally").
- **Type consistency:** the column is `verifiedAt` (TS) / `verified_at` (SQL) everywhere; the flag is `--verify` → `args.flags.verify === true` → local `verify`; the select alias `fileXxh3` is introduced in T2-S5 and consumed in T3-S3; `mismatches` is declared in T2-S4 and incremented in T3-S3 and printed in T3-S4.
- **No silent caps:** `--verify` reports its mismatch count in the summary line, so a verify pass never hides what it found.
