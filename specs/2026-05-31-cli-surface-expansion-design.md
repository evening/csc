# CLI surface expansion — Design

**Date:** 2026-05-31
**Status:** Approved for planning
**Scope:** Nine additions to the `csc` command surface: `drive rename`, `drive rm`, `drive note`, a global `--db` flag, `--json` on read commands, `scan --progress`, `scan --dry-run`, `csc ls`, and `csc find`.

This is intentionally broad; see **Decomposition for implementation** — it should ship as several independent plans, not one.

## Motivation

The README pitches `csc` as answering two questions: "is this backed up?" and "what's on hd3?". The first is well served (`check`, `whereis`); the second has **no command** today. It also has no way to fix a drive's label/note after creation, no way to retire a dead drive, and no machine-readable output. These additions close those gaps while staying consistent with the tool's existing conventions (the `--yes` guard for destructive ops, content-addressed identity, fail-toward-caution).

## Cross-cutting UX principles

These apply to every feature below and keep the surface coherent:

- **`--yes` guards destructive, irreversible ops** (only `drive rm` here). Renames/notes are reversible, so no guard.
- **Progress and diagnostics go to stderr; data goes to stdout.** This keeps `--json` and piped output clean.
- **`--json` suppresses all human output** and emits a single document on stdout. Exit codes are unchanged by `--json`.
- **`--db` (CLI) overrides `CSC_DB` (env) overrides the default** `~/.csc/catalog.db`.
- **Prefix/subpath matching uses exact-prefix (`substr`) comparison, never SQL `LIKE`** — consistent with the existing prune logic in `scan.ts`, because `_` in directory names breaks `LIKE`.

---

## Feature 1 — Global `--db <path>` flag

**Purpose:** Point any command at a specific catalog without exporting an env var (multiple catalogs, testing, scripts).

**Syntax:** `csc <any-command> ... --db /path/to/catalog.db`

**Behavior:** In `src/cli.ts`, after `parseArgs`, if `args.flags.db` is a string, set `process.env.CSC_DB = args.flags.db` before dispatching. `config.ts:dbPath()` then resolves it unchanged. Precedence: CLI `--db` > `CSC_DB` env > default path. No per-command threading needed.

**Edge cases:** `--db` with no value (parsed as `true`) → error: `--db requires a path`.

---

## Feature 2 — `drive rename <old> <new>`

**Purpose:** Fix a label after creation. (Today there is no way.)

**Syntax:** `csc drive rename hd3 hd3-tv`

**Behavior:** Update `drives.label` from `<old>` to `<new>`. Non-destructive and reversible, so no `--yes`.

**Edge cases:**
- `<old>` does not exist → error: `unknown drive label: <old>`.
- `<new>` already in use → error: `drive label "<new>" already exists` (don't rely on the raw unique-constraint failure; check first and message clearly).
- Missing args → usage error.

**Output:** `renamed drive <old> → <new>`

---

## Feature 3 — `drive note <label> [text]`

**Purpose:** Set, view, or clear a drive's note after creation.

**Syntax:**
- `csc drive note hd3 "tv shows archive"` — set/replace the note.
- `csc drive note hd3` — print the current note (or `(no note)`).
- `csc drive note hd3 --clear` — remove the note (set to NULL).

**Behavior:** Updates `drives.notes`. Setting and clearing print a confirmation; the no-arg form is read-only.

**Edge cases:**
- `<label>` does not exist → error.
- Both text and `--clear` given → error: `pass either a note or --clear, not both`.

**Output:** `updated note for hd3` / `cleared note for hd3` / the note text (read form).

---

## Feature 4 — `drive rm <label> --yes`

**Purpose:** Retire a sold, dead, or repurposed drive from the catalog.

**Syntax:** `csc drive rm hd3 --yes`

**Behavior:** In a single transaction: delete all `locations` rows for that drive, then delete the `drives` row. The `--yes` flag is **required** (FK pragma is on, and this destroys location history). Deleting locations first avoids the foreign-key violation.

**Orphaned files:** `files` rows whose only locations were on this drive become orphaned (zero locations). They are **left in place** — harmless (they resolve to `✗` in `check`) and cheap. A future `csc gc` could prune them; out of scope here (YAGNI).

**Edge cases:**
- Without `--yes` → error: `drive rm is destructive; pass --yes to confirm`.
- `<label>` does not exist → error.

**Output:** `removed drive hd3 (412 locations deleted)`

---

## Feature 5 — `csc ls <label> [subpath]`

**Purpose:** Answer "what's on hd3?" — list the files the catalog records on a drive, offline.

**Syntax:**
- `csc ls hd3` — every recorded path on hd3.
- `csc ls hd3 movies` — only paths under `movies/` (exact-prefix match).
- `csc ls hd3 --json`

**Behavior:** Query `locations` joined to `files` where `drive_id = <label>.id`, optionally filtered to `path_on_drive` beginning with `<subpath>` + `/` (exact-prefix `substr`, not `LIKE`). Sort by `path_on_drive`.

**Output (human):** one line per file: the path, a human size, and an `asserted` marker for unverified locations:

```
movies/inception.mkv        7.4 GB
movies/the-matrix.mkv       6.1 GB
shows/foo.s01e01.mkv        1.2 GB   (asserted)
3 files, 14.7 GB
```

**Output (`--json`):** array of `{ path_on_drive, size_bytes, xxh3, verification }`.

**Edge cases:** unknown label → error; drive with zero recorded files → `0 files, 0 B` (human) / `[]` (json).

---

## Feature 6 — `csc find <pattern> [--drive <label>] [--glob]`

**Purpose:** Locate a file when you remember its name but not its path or hash. (`whereis` requires an exact path or raw hash; this is the fuzzy entry point.)

**Syntax:**
- `csc find wedding` — case-insensitive **substring** match on `path_on_drive`, across all drives.
- `csc find '*.mov' --glob` — glob match instead of substring.
- `csc find wedding --drive hd3` — restrict to one drive.
- `csc find wedding --json`

**Behavior:** Fetch candidate `locations`+`files`+`drives` rows (optionally scoped by `--drive`) and match `path_on_drive` in application code: case-insensitive substring by default, or glob when `--glob` is set. Matching in code (not SQL `LIKE`) sidesteps the underscore problem and keeps glob/substring semantics explicit. For a single-user catalog the row count is small enough that this is fine.

**Output (human):** grouped by drive, path + size:

```
hd3   2019/wedding-ceremony.mov     3.1 GB
hd3   2019/wedding-reception.mov    5.8 GB
hd5   backups/wedding-raw.mov       22.0 GB
3 matches on 2 drives
```

**Output (`--json`):** array of `{ drive, path_on_drive, size_bytes, xxh3, verification }`.

**Edge cases:** no matches → `no matches` (human, exit 0) / `[]` (json); unknown `--drive` → error.

---

## Feature 7 — `scan --progress` / `--no-progress`

**Purpose:** The workhorse command can run for *hours* and currently prints nothing until it finishes. Give live feedback.

**Behavior:** A throttled running tally written to **stderr** (so stdout/`--json` stay clean), updated at most ~once/second:

```
scanning hd3… 12,431 files, 842 GB hashed, 03:14 elapsed
```

- **Auto-enabled** when stderr is a TTY (`process.stderr.isTTY`); **auto-disabled** when piped/redirected.
- `--progress` forces it on (e.g. when logging a non-interactive run); `--no-progress` forces it off.
- The final one-line summary (`scanned drive … (N files, pruned M)`) still prints to stdout as today.

**Note:** progress is a display concern only; it never changes what scan writes. It updates as files are hashed (skipped files via the resume optimization advance the file counter but not the bytes-hashed counter).

---

## Feature 8 — `scan --dry-run`

**Purpose:** Preview what a scan would change before committing to an hours-long, catalog-mutating run.

**Behavior:** Perform the full walk and hashing (reads are unavoidable to know what's there) but **write nothing** — no `files`/`locations` upserts, no pruning, no drive-stat update, and **no sentinel write**. Still perform the sentinel **check** so a wrong-drive dry-run fails loudly exactly as a real scan would. Compare each walked file against the catalog and tally:

```
dry-run for hd3 (no changes written):
  would add:     128 files
  would update:    3 files (content changed)
  would prune:     5 locations
  unchanged:   12,295 files
```

- Combines with `--verify`: `scan --dry-run --verify` re-hashes everything and reports would-be content mismatches without writing.
- On a never-scanned drive with no sentinel: report `would initialize sentinel` instead of failing, and proceed read-only.
- Exits 0. `--dry-run` is read-only and safe by definition, so no `--yes`.

---

## Feature 9 — `--json` on read commands

**Purpose:** Machine-readable output for scripting; pairs with the `check` exit code from the prior spec.

**Applies to:** `check`, `whereis`, `ls`, `find`, `drive list`. **Add it to all of them or none** — partial JSON support is a worse UX than none.

**Behavior:** When `--json` is set, suppress all human lines and print one JSON document to stdout. Exit codes are unchanged (e.g. `check --json` still exits 1 when something is missing). For `check`, `--json` emits the **full** per-file array regardless of the human filter flags (`--missing` etc.) — those flags are a human-output convenience; machine consumers filter themselves.

**Document shapes:**

- `drive list --json` → array of
  `{ label, uuid, capacity_bytes, free_bytes, last_scanned, files, bytes, notes }`
- `check --json` →
  `{ summary: { total, backed_up, asserted_only, missing, unbacked_bytes }, files: [ { path, status: "backed_up"|"asserted"|"missing", drives: [ { label, verification } ] } ] }`
- `whereis --json` →
  `{ query, xxh3, size_bytes, locations: [ { label, path_on_drive, verification } ] }`
- `ls --json` → array of `{ path_on_drive, size_bytes, xxh3, verification }`
- `find --json` → array of `{ drive, path_on_drive, size_bytes, xxh3, verification }`

**Note:** this feature is specified last because its shapes depend on `ls` and `find` existing.

---

## Components touched

- `src/cli.ts` — `--db` handling; new `drive` subcommands (`rename`, `note`, `rm`); new top-level commands (`ls`, `find`); `USAGE` updates for everything.
- `src/commands/drive-rename.ts`, `src/commands/drive-note.ts`, `src/commands/drive-rm.ts` — new (one file per subcommand, matching the existing pattern).
- `src/commands/ls.ts`, `src/commands/find.ts` — new.
- `src/commands/scan.ts` — `--progress`/`--no-progress` (stderr tally) and `--dry-run` (read-only path).
- `src/commands/check.ts`, `drive-list.ts`, `whereis.ts`, `ls.ts`, `find.ts` — `--json` branches.
- `src/format.ts` — possible shared helper for emitting JSON / formatting `ls`/`find` rows (reuse `fmtBytes`).
- `tests/commands/*` — one test file per new command; `--json` assertions added to existing read-command tests; `scan` tests for `--dry-run` (writes nothing) and progress gating.
- `README.md` — document all nine; add a "what's on hd3?" example using `ls`/`find`.

## Decomposition for implementation

Ship as **five independent plans**, in this order (each leaves the tool working and tested):

1. **`--db` global flag** — tiny, foundational, unblocks easier testing of the rest.
2. **`drive` subcommands** — `rename`, `note`, `rm`. Self-contained, share the `drives`-table access pattern.
3. **`ls` + `find`** — the "what's on hd3?" capability. Independent read commands.
4. **`--json`** — applied across `check`, `whereis`, `drive list`, `ls`, `find`. Sequenced after #3 so `ls`/`find` exist to cover.
5. **`scan --progress` + `--dry-run`** — both touch only `scan.ts`; grouped together.

Plans #2–#5 are mutually independent and could be done in any order after #1; the ordering above is the recommended path.

## Testing strategy

- **`--db`:** a command run with `--db /tmp/x.db` writes to that path, not to `CSC_DB`; CLI flag wins over a set env var.
- **`drive rename`:** label changes; renaming to an existing label errors; renaming a nonexistent drive errors.
- **`drive note`:** set, read-back, `--clear`, and the text-plus-`--clear` conflict.
- **`drive rm`:** drive and its locations gone; orphaned `files` rows remain; missing `--yes` errors; cascade leaves *other* drives untouched.
- **`ls`:** lists only the target drive's paths; subpath prefix filter excludes siblings (include the `music_archive` vs `music-archive` underscore guard, mirroring the scan test); asserted marker shown; `--json` shape.
- **`find`:** substring match across drives; `--glob`; `--drive` scope; no-match exit 0; `--json` shape.
- **`scan --dry-run`:** row counts in the DB are identical before and after; no sentinel written on a fresh drive; sentinel mismatch still errors; reported tallies match a subsequent real scan's effect.
- **`scan --progress`:** auto-off when stderr is not a TTY (assert nothing extra on stdout); the final stdout summary is unchanged.
- **`--json` everywhere:** valid JSON, no human lines mixed in, exit codes preserved (`check --json` still exits 1 on missing).

## Decisions made inline (call out at review if any are wrong)

1. **`find` defaults to case-insensitive substring**, with `--glob` for glob patterns; searches `path_on_drive`, not NAS paths. (NAS paths aren't durably in the catalog; drive paths are what answer "where did I put it?".)
2. **`drive note` with no text prints** the current note; `--clear` removes it. Empty-string set is treated as clear-equivalent.
3. **`drive rm` leaves orphaned `files` rows** rather than garbage-collecting them; a `gc` command is out of scope.
4. **`scan --progress` auto-detects a TTY** rather than being purely manual, because forgetting a flag on an 11-hour run is the exact failure we're fixing. `--progress`/`--no-progress` override.
5. **`--json` ignores `check`'s human filter flags** and always emits all files.
6. **`scan --dry-run` still hashes** (it must, to know what changed) — it is read-only, not cheap.

## Out of scope

- `csc gc` (orphan cleanup), config-file-driven drives (decided against earlier — env vars stay), ignore patterns (separate spec), `--no-color`/`-q` global flags, JSON streaming, and any change to status *computation*.
