# csc — hands-on tutorial

A 9-step walkthrough of the core flow, using two local folders to stand in for
a real setup. In production these map to:

- **source** = your live NAS (the thing you ask "is this backed up?")
- **drive**  = a cold-storage drive you scan once, then shelve

> **Key idea:** you never *scan* the source. `scan` reads bytes off a **drive**.
> For the source you run `check`, which asks "is each of these files on a drive
> I've already scanned?" Files are matched by **content (xxh3 + size), not path** —
> so renames don't fool it.

## Setup

Use an isolated catalog DB so you don't touch your real one at `~/.csc/catalog.db`.
(Note: `CSC_DB` is used verbatim — no `~` expansion — so use an absolute path.)

```bash
export CSC_DB="$HOME/git/catalog/demo/catalog.db"
mkdir -p ~/git/catalog/demo/source ~/git/catalog/demo/drive
cd ~/git/catalog/demo/../        # run csc from the repo root: ~/git/catalog

# seed the source with a few files
echo "the matrix"   > ~/git/catalog/demo/source/matrix.mkv
echo "inception"    > ~/git/catalog/demo/source/inception.mkv
echo "interstellar" > ~/git/catalog/demo/source/interstellar.mkv
```

All commands below are `bun run csc ...` (run from `~/git/catalog`).
Tip: `alias csc='bun run csc'` to shorten them.

---

## 1. Register a drive

The label (`backup`) is just a human name; it doesn't have to match the folder.

```bash
bun run csc drive add backup
# added drive backup

# you can attach a note AT CREATION time (no rename/edit command exists later):
# bun run csc drive add backup --notes "tv shows archive"
```

## 2. Scan the drive (it's empty — confirm nothing is recorded)

`scan` walks the drive, hashes every file, writes a `.csc-drive-id` sentinel at
its root, and records what it found. Right now the drive is empty.

```bash
bun run csc scan backup --mount ~/git/catalog/demo/drive
# scanned drive backup (0 files, pruned 0)
```

## 3. Check the source — everything is missing

```bash
bun run csc check ~/git/catalog/demo/source
# ✗ .../source/inception.mkv     not backed up
# ✗ .../source/interstellar.mkv  not backed up
# ✗ .../source/matrix.mkv        not backed up
```

Every `✗` is a file not on any scanned drive. This is your "what do I still
need to copy?" list.

## 4. Copy a file to the drive

csc never copies — that's your job (rsync / cp / Finder).

```bash
cp ~/git/catalog/demo/source/matrix.mkv ~/git/catalog/demo/drive/
```

## 5. Rescan + re-check — see it flip to ✓

The catalog only learns about the new file after a rescan.

```bash
bun run csc scan backup --mount ~/git/catalog/demo/drive
# scanned drive backup (1 files, pruned 0)

bun run csc check ~/git/catalog/demo/source
# ✓ .../source/matrix.mkv        backup      <- now backed up
# ✗ .../source/inception.mkv     not backed up
# ✗ .../source/interstellar.mkv  not backed up
```

## 6. Rename the file ON THE DRIVE

Simulate the file living under a different name on the cold drive.

```bash
mv ~/git/catalog/demo/drive/matrix.mkv ~/git/catalog/demo/drive/the-matrix-1999.mkv
bun run csc scan backup --mount ~/git/catalog/demo/drive
```

## 7. Confirm it's still found

```bash
bun run csc check ~/git/catalog/demo/source
# ✓ .../source/matrix.mkv        backup      <- STILL backed up

bun run csc whereis ~/git/catalog/demo/source/matrix.mkv
# backup  the-matrix-1999.mkv               <- different path, same content
```

Matched by content, not name. The rename on the drive is invisible to `check`.

## 8. Rename the file ON THE SOURCE

```bash
mv ~/git/catalog/demo/source/matrix.mkv ~/git/catalog/demo/source/matrix-remaster.mkv
```

## 9. Confirm it's still found

```bash
bun run csc check ~/git/catalog/demo/source
# ✓ .../source/matrix-remaster.mkv   backup  <- STILL backed up
```

Same content hash → still resolves to the copy on `backup`, regardless of the
new name on either side.

---

## What to try next

- **Edit (don't rename) a file**, then re-check — the bytes change, the hash
  changes, and it correctly flips back to `✗`. Renames are safe; edits are not.
  ```bash
  echo "extra footage" >> ~/git/catalog/demo/source/matrix-remaster.mkv
  bun run csc check ~/git/catalog/demo/source   # -> ✗
  ```
- **Prune:** delete a file from the drive and rescan — `scan` reports `pruned N`
  and the file drops back to `✗`.
- **`--summary`:** `bun run csc check ~/git/catalog/demo/source --summary` for
  aggregate counts instead of per-file lines.
- **Assert:** `bun run csc assert backup ~/git/catalog/demo/source --yes` records
  locations as `⚠ asserted` (claimed but unverified) — never a clean `✓` until a
  real scan confirms them.
- **Second drive:** add `backup2`, copy a file there too, and `whereis` will list
  both drives for that file.

## Reset

```bash
rm -rf ~/git/catalog/demo/catalog.db* ~/git/catalog/demo/source ~/git/catalog/demo/drive
```

## Drive admin — current limits

- Notes can be set **only** at `drive add` time (`--notes "..."`).
- There is **no** `drive rename` and **no** way to edit a note via the CLI.
  The only `drive` subcommands are `add`, `list`, `rebind`.
- To change a label or note today you'd edit the `drives` table in the SQLite
  DB directly.

