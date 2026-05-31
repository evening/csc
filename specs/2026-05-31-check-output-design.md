# `csc check` output filtering + exit code — Design

**Date:** 2026-05-31
**Status:** Approved for planning
**Scope:** The `check` command only — its output verbosity and exit code. Ignore patterns (skipping `.DS_Store`, `@eaDir`, etc.) are explicitly **out of scope** and will be a separate spec.

## Problem

`csc check <path>` currently prints one line per file walked, with `✓` (backed up) lines dominating the output. The actionable lines (`✗` not backed up, `⚠` asserted-only) get buried, and a large NAS subtree produces an unreadable wall of text. There is also no machine-friendly signal: a script can't tell from the exit code whether everything is backed up, so `check` can't gate a destructive action or a cron sanity-check.

This inverts the tool's own ethos ("surface what needs action; fail toward under-claiming") — the boring good news is loudest, the actionable bad news is hidden.

## Goals

1. Quiet by default — show only the summary unless the user asks for detail.
2. Let the user list exactly the subset of states they care about.
3. Make `check` scriptable via a meaningful exit code.

## Non-goals

- Ignore/exclude patterns (separate spec).
- Grouping/paging/collapsing output by directory.
- JSON or other machine-readable output formats.
- Any change to how backed-up status is *computed* (the `files`/`locations` lookup in `check.ts` is unchanged).

## Design

### The three states

Every file `check` walks resolves to exactly one state, already computed today in `src/commands/check.ts`:

- `✓` **backed up** — at least one `scanned` location.
- `⚠` **asserted-only** — only `asserted` locations, no `scanned` ones.
- `✗` **not backed up** — not in the catalog (or in the catalog with zero locations).

### Output flags

All flags default to off. With no flag, `check` prints **only the summary line**.

| Flag | Lists |
|------|-------|
| `--missing` | `✗` lines |
| `--asserted` | `⚠` lines |
| `--backed-up` | `✓` lines |
| `--all` | all three (equivalent to `--missing --asserted --backed-up`) |

Rules:
- Flags **OR** together: `--missing --asserted` lists both `✗` and `⚠`.
- `--all` is sugar for setting all three; combining it with another flag is harmless (still lists all).
- The **summary line always prints** as a footer, even when one or more listings are shown, and even when a listing matches zero files.
- The previously-existing `--summary` flag is **removed**. Its behavior (summary only) is now the default. (No deprecation alias — this is a single-user tool.)

### Output format (unchanged)

Per-file lines keep the current glyphs and shape, e.g.:

```
✓ /Users/me/nas/movies/foo.mkv  hd3
⚠ /Users/me/nas/movies/baz.mkv  hd5 (asserted, unverified)
✗ /Users/me/nas/movies/bar.mkv  not backed up
```

When listing multiple states, lines appear in walk order (the order `walk()` yields), interleaved by state — no grouping or re-sorting.

The summary line keeps its current wording:

```
412 files, 374 backed up, 1 asserted-only, 37 not backed up, 4.1 TB unbacked
```

### Examples

```
$ csc check ~/nas/movies
412 files, 374 backed up, 1 asserted-only, 37 not backed up, 4.1 TB unbacked

$ csc check ~/nas/movies --missing
✗ /Users/me/nas/movies/bar.mkv  not backed up
... (36 more ✗ lines)
412 files, 374 backed up, 1 asserted-only, 37 not backed up, 4.1 TB unbacked

$ csc check ~/nas/movies --missing --asserted
✗ /Users/me/nas/movies/bar.mkv  not backed up
⚠ /Users/me/nas/movies/baz.mkv  hd5 (asserted, unverified)
... 
412 files, 374 backed up, 1 asserted-only, 37 not backed up, 4.1 TB unbacked

$ csc check ~/nas/movies --all
✓ /Users/me/nas/movies/foo.mkv  hd3
⚠ /Users/me/nas/movies/baz.mkv  hd5 (asserted, unverified)
✗ /Users/me/nas/movies/bar.mkv  not backed up
...
412 files, 374 backed up, 1 asserted-only, 37 not backed up, 4.1 TB unbacked
```

### Exit code

- `0` — zero `✗` files (everything is backed up or asserted; or the path had no files).
- `1` — one or more `✗` files.

`⚠` (asserted-only) does **not** affect the exit code — it counts as "claimed backed up" for exit purposes, matching the requested behavior. (If stricter "an unverified claim should also fail the gate" semantics are wanted later, that is a one-line change: include the asserted-only count in the non-zero condition. Deliberately not done now.)

This makes `check` composable:
```bash
csc check ~/nas/old-project --missing && rm -rf ~/nas/old-project
```
The `rm` runs only if nothing in `old-project` is unbacked.

Implementation note: set `process.exitCode = 1` from within `check()` when the missing count is `> 0`. Do not `throw` — a non-zero exit here is a normal result, not an error, and must not be routed through the `die()` path in `src/cli.ts` (which is for thrown errors).

## Components touched

- `src/commands/check.ts` — parse the four flags; decide per-file whether to print based on state + active flags; remove the `--summary` branch and always print the summary footer; set `process.exitCode` based on the missing count.
- `src/cli.ts` — update the `USAGE` string: replace the `[--summary]` on the `check` line with the new flags.
- `tests/commands/check.test.ts` — update the existing `--summary` test; add tests for each filter flag, flag combination, the always-on summary footer, and the exit-code behavior.
- `README.md` — update the "Check what's backed up" section: document the new flags, that summary is the default, and the exit code.

## Testing strategy

- **Default is summary-only:** walk a tree with a mix of states, assert no `✓`/`⚠`/`✗` per-file lines are printed and the summary line is.
- **Each filter flag lists only its state** and still prints the summary footer.
- **Flag combination** (`--missing --asserted`) lists exactly those two states.
- **`--all`** lists all three.
- **Empty match:** `--missing` when nothing is missing prints only the summary (no per-file lines).
- **Exit code:** `process.exitCode` is `1` when something is `✗`, `0` when nothing is `✗` (including the asserted-only-present case, which must stay `0`).
- Capture `console.log` (as existing tests do) to assert on printed lines; read `process.exitCode` after the call and reset it between tests.

## Open questions

None. The two judgment calls (asserted-only excluded from exit code; `--summary` removed outright) were resolved during brainstorming.
