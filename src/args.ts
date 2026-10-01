export type Args = { positional: string[]; flags: Record<string, string | boolean> };

// Flags that never take a value, so `csc check --summary /path` doesn't treat
// /path as the value of --summary.
const BOOLEAN_FLAGS = new Set(['yes', 'summary', 'progress', 'no-progress']);

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next != null && !next.startsWith('--')) {
        flags[key] = next; i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}
