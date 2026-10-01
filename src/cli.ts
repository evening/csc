#!/usr/bin/env bun
import { die } from './format';
import { parseArgs, type Args } from './args';

const USAGE = `csc — cold storage catalog

usage:
  csc drive add <label> [--notes "..."]
  csc drive list
  csc drive rebind <label> --yes [--mount <path>]
  csc scan <label> [path] [--mount <path>] [--progress|--no-progress]
  csc check <nas-path>... [--summary] [--progress|--no-progress]
  csc ls <label> [subpath]
  csc whereis <nas-path-or-hash>
  csc assert <label> <nas-path> --yes

progress is shown on stderr automatically when it's a terminal.
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(rest);

  switch (cmd) {
    case 'drive': {
      const sub = args.positional.shift();
      switch (sub) {
        case 'add': {
          const { driveAdd } = await import('./commands/drive-add');
          await driveAdd(args);
          return;
        }
        case 'list': {
          const { driveList } = await import('./commands/drive-list');
          await driveList(args);
          return;
        }
        case 'rebind': {
          const { driveRebind } = await import('./commands/drive-rebind');
          await driveRebind(args);
          return;
        }
        default:
          die(`unknown drive subcommand: ${sub ?? '(missing)'}`);
      }
    }
    case 'scan': {
      const { scan } = await import('./commands/scan');
      await scan(args);
      return;
    }
    case 'check': {
      const { check } = await import('./commands/check');
      await check(args);
      return;
    }
    case 'ls': {
      const { ls } = await import('./commands/ls');
      await ls(args);
      return;
    }
    case 'whereis': {
      const { whereis } = await import('./commands/whereis');
      await whereis(args);
      return;
    }
    case 'assert': {
      const { assertCmd } = await import('./commands/assert');
      await assertCmd(args);
      return;
    }
    default:
      die(`unknown command: ${cmd}`);
  }
}

export type { Args };

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
