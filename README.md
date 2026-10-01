# csc — cold storage catalog

A small CLI that catalogs which files live on which offline drives, so you can answer "what's on hd3?" and "what haven't I backed up?" without plugging every drive in and digging.

## The problem

You have a NAS full of data and a stack of cold-storage drives. After enough drives accumulate, two questions get hard to answer:

1. **"Is this file backed up?"** — You want to know, before you delete a project from the NAS, whether some archive drive has a copy. Plugging in five drives to check is annoying.
2. **"What's on hd3?"** — Years later, you want to find a specific file. You remember backing it up, but to which drive?

`csc` is a metadata-only catalog. You scan each drive once when you fill it (the bytes get read, files get hashed, locations recorded), then the drive goes back on the shelf. The catalog lives in a single SQLite database. Querying the catalog never needs the drive plugged in.

## What it deliberately doesn't do

This is the smallest tool that answers those two questions. It is explicitly *not*:

- **A copy tool.** Use rsync / Finder / whatever. `csc` only observes — it never writes to your media.
- **An integrity verifier.** xxh3 detects "different bytes" but doesn't promise bitrot freedom. A drive that silently rots will eventually produce different hashes on rescan; that's detection-by-accident, not a verification feature.
- **git-annex.** If you want managed storage, content-addressed object stores, automated copies, and `numcopies` enforcement, use git-annex. `csc` keeps your filesystem as your filesystem and just remembers what it saw.
- **A multi-machine sync tool.** Single SQLite DB on one host.

## Install

```bash
bun install
bun run csc --help
```

The catalog DB lives at `~/.csc/catalog.db` by default — override with `CSC_DB`.

Set up mount aliases so you don't have to type `--mount` every time:

```bash
export CSC_MOUNT_HD3=/Volumes/hd3
export CSC_MOUNT_HD5=/Volumes/hd5
```

## Commands

### Register a drive

```bash
csc drive add hd3
csc drive add hd5 --notes "tv shows archive"
```

### Scan a drive (the workhorse)

```bash
csc scan hd3 --mount /Volumes/hd3
```

Walks the drive, hashes every file, records each location. The first scan of a 6 TB drive at ~150 MB/s is ~11 hours of reading. Subsequent scans skip files whose `(path, size, mtime)` matches what's already recorded — so resuming an interrupted scan or re-scanning an unchanged drive is fast.

Scope to a subtree if you don't need to re-walk the whole drive:

```bash
csc scan hd3 movies --mount /Volumes/hd3
```

On a terminal, scan shows a live progress line on stderr (`scanning hd3… 12,431 files, 842 GB hashed (152 MB/s), 03:14:05 elapsed`). `--progress` forces it on when output isn't a terminal (a plain line every 30 s, for log files); `--no-progress` turns it off.

Scan also **prunes**: files no longer found on the drive get their location rows removed. Only within the scanned subtree, and only `scanned` rows — manual `asserted` rows are preserved.

### Check what's backed up

```bash
csc check ~/nas/movies
```

Walks a NAS path. For each file:

```
✓ /Volumes/nas/movies/foo.mkv  hd3
⚠ /Volumes/nas/movies/bar.mkv  hd5 (asserted, unverified)
✗ /Volumes/nas/movies/new.mkv  not backed up
```

- `✓` — file is on one or more scanned drives. Verified.
- `⚠` — only manual assertions back it up (see `csc assert`). Trust at your discretion.
- `✗` — not in the catalog. Make a backup.

Pass several paths to check them in one run (the summary covers all of them):

```bash
csc check --summary /Volumes/media/movies /Volumes/media/tv /Volumes/media/vns
```

Add `--summary` for aggregate counts:

```
412 files, 374 backed up, 0 asserted-only, 38 not backed up, 4.1 TB unbacked
```

Like `scan`, `check` shows live progress on stderr when it's a terminal (`--progress` / `--no-progress` to override).

`check` is cheap after the first run. It caches NAS file hashes by `(path, size, mtime)`, so re-checking an unchanged subtree is a directory walk plus SQLite lookups — seconds, not hours.

### List what's on a drive

```bash
csc ls hd3
csc ls hd3 movies
```

Every recorded path on the drive (or under one folder of it, by exact prefix), with sizes and a total. Works with the drive on the shelf — it only reads the catalog. Unverified locations are marked `(asserted)`.

```
movies/inception.mkv        7.4 GB
movies/the-matrix.mkv       6.1 GB
shows/foo.s01e01.mkv        1.2 GB   (asserted)
3 files, 14.7 GB
```

### Locate a single file

```bash
csc whereis ~/nas/movies/foo.mkv
csc whereis 362eb1e6100cd228
```

By path or by raw 16-hex hash. Lists every drive the catalog says the file is on.

### Manually record a location

For when you *know* a file is on hd5, but hd5 is shucked in a drawer:

```bash
csc assert hd5 ~/nas/movies --yes
```

Walks the NAS path, hashes each file, records the locations as `asserted` (not `scanned`). These show up in `check` as `⚠`, never as a clean `✓`, until you actually plug hd5 in and `csc scan` it. The `--yes` flag is required to discourage casual use.

If a file is already `scanned` on a drive, `assert` will *not* downgrade it.

### List drives

```bash
csc drive list
```

Tab-separated: label, uuid, capacity, free, last scanned, file count, total bytes, notes.

### Recover from a missing sentinel

```bash
csc drive rebind hd3 --yes --mount /Volumes/hd3
```

If the `.csc-drive-id` sentinel file got deleted by accident, this rewrites it from the recorded UUID. Refuses if a *different* sentinel is present — that's a wrong-drive situation, not a recovery case.

## How it works

### Clutter is ignored

Every walk (`scan`, `check`, `assert`) skips OS and NAS junk by name, at any depth, along with everything under a matching directory:

- macOS: `.DS_Store`, `._*` (AppleDouble sidecars), `.fseventsd`, `.Spotlight-V100`, `.Trashes`, `.TemporaryItems`, `.DocumentRevisions-V100`, `.metadata_never_index`
- Synology: `@eaDir` (thumbnails), `#recycle`, `#snapshot`
- Windows: `Thumbs.db`, `desktop.ini`, `$RECYCLE.BIN`, `System Volume Information`

The list lives in `src/walker.ts`. Without it, `check` on a Synology share reports thousands of thumbnail files as "not backed up".

### Identity is content, not path

Files are identified by `(xxh3, size_bytes)`, not by their path. Renames don't create phantom new files. Two files with identical content (e.g., a movie at two paths) collapse to one `files` row in the catalog.

xxh3 is non-cryptographic — it's chosen for speed (~4 GB/s on a modern Mac), not security. Size as a tiebreaker makes accidental collisions effectively impossible without paying for a bigger hash.

### Drives are identified by UUID, not label

The label "hd3" is for humans. The catalog identifies a physical drive by a UUID written to `.csc-drive-id` at the drive root, written on first scan.

If you relabel a drive, swap one for another, or accidentally remount a different drive at the same path, `csc scan` refuses with a clear error rather than poisoning the catalog. This is the most important safety property of the tool.

### The data model

```
drives                files                 locations
------                -----                 ---------
id                    id                    id
label  (uniq)         xxh3      ┐           file_id  ──> files.id
uuid   (uniq)         size      │ (uniq)    drive_id ──> drives.id   ┐
size_bytes            first_seen┘           path_on_drive             │ (uniq together)
free_bytes            last_seen             verification ('scanned'|'asserted')
last_scanned                                mtime
notes                                       recorded_at
```

Plus `nas_hash_cache` — path-keyed by absolute NAS path, used only by `check` to avoid re-hashing unchanged files.

### The asymmetric trust rule

The NAS gets a metadata cache. Cold drives never do. This is a correctness rule, not a performance trick:

- `check` trusts NAS `(path, size, mtime)` — your live filesystem isn't trying to lie to you about your own files.
- `scan` always reads bytes. The whole reason scan exists is to find out what's *really* on the drive. A metadata shortcut would defeat the point.

The frequent operation (check) is cheap. The expensive operation (scan) is rare — once per drive, when you fill it.

### Fail toward under-claiming

Every ambiguous situation resolves toward "not backed up" rather than "backed up". A false negative makes you redundantly copy something (annoying but safe). A false positive makes you trust a backup that isn't there (data loss). The latter is much worse.

## Common flows

Every flow below has an integration test under `tests/integration/`:

- **Standard backup**: write file on NAS → `check` (`✗`) → copy to drive → `csc scan` → `check` (`✓`)
- **NAS rename**: a file gets renamed on the NAS → `check` still finds it (re-hashes once, looks up by content)
- **Multi-drive**: same file on two drives → `check` lists both
- **Asserted then scanned**: `csc assert` while drive is away → later `csc scan` actually verifies → location upgrades from `asserted` to `scanned`
- **NAS delete**: file removed from NAS → no longer in `check` output, but the catalog row remains (a future scan would still find it on the drive)
- **Edit in place**: NAS file edited and its size changes → cache invalidated → `check` re-evaluates and correctly reports the new content as unbacked

## Developer guide

### Layout

```
src/
  cli.ts                # entry point, arg parser, command dispatch
  config.ts             # CSC_DB path, mount resolution
  hash.ts               # xxh3 streaming hash
  sentinel.ts           # .csc-drive-id read/write
  walker.ts             # deterministic recursive file walker + clutter ignore list
  args.ts               # argv parsing (boolean flags never consume a value)
  progress.ts           # stderr progress line for scan/check
  format.ts             # output helpers (fmtBytes, die)
  db/
    schema.ts           # drizzle table definitions
    client.ts           # openDb() — WAL, FK pragmas, migrations
    migrate.ts          # one-shot CLI helper
  commands/             # one file per subcommand
drizzle/                # generated migrations (do not edit by hand)
tests/
  *.test.ts             # per-module unit tests
  integration/          # narrative end-to-end tests
```

### Stack

- **Bun** runtime + TypeScript
- **SQLite** via `bun:sqlite` (synchronous — keeps the scan loop simple)
- **Drizzle** ORM with **drizzle-kit** migrations
- **xxhash-addon** for native xxh3 hashing (~4 GB/s on a modern Mac, well above disk speed)
- **bun:test** for tests

### Run

```bash
bun run csc <cmd> ...    # invoke the CLI
bun test                 # full test suite (unit + integration)
bun run typecheck        # tsc --noEmit
bun run db:generate      # regenerate the migration from src/db/schema.ts
```

### Adding a new command

1. Add `src/commands/<name>.ts` exporting an async function that takes `Args` and returns `Promise<void>`.
2. Wire it into the dispatch in `src/cli.ts` (use a dynamic import to keep cold-start cheap).
3. Add the usage line to the `USAGE` constant.
4. Add unit tests under `tests/commands/<name>.test.ts` — use the `CSC_DB` env var + tmpdir pattern from existing command tests.
5. If the command exercises a new cross-command state transition, add an integration test under `tests/integration/`.

### Design rules to keep in mind

- **Identity is content, not path.** Never query files by path alone.
- **scan reads bytes, always.** Don't add an mtime shortcut to scan. The NAS cache is the only mtime shortcut allowed.
- **Asserted rows never become scanned silently** unless `scan` actually saw the file. The upgrade is intentional and represents real verification.
- **Subtree scans only prune within the subtree.** Use exact-prefix matching (`substr`), not SQL `LIKE` — `_` in directory names breaks LIKE.
- **Fail loudly.** Sentinel mismatches, missing mounts, read-only drives — surface clearly, don't paper over.

