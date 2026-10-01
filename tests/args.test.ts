import { describe, it, expect } from 'bun:test';
import { parseArgs } from '../src/args';

describe('parseArgs', () => {
  it('value flags consume the next token', () => {
    expect(parseArgs(['hd3', '--mount', '/Volumes/hd3'])).toEqual({
      positional: ['hd3'], flags: { mount: '/Volumes/hd3' },
    });
  });

  it('boolean flags never swallow a following positional', () => {
    expect(parseArgs(['--summary', '/nas/anime', '--progress', '/nas/tv'])).toEqual({
      positional: ['/nas/anime', '/nas/tv'], flags: { summary: true, progress: true },
    });
    expect(parseArgs(['hd3', '--yes', '/nas/x']).positional).toEqual(['hd3', '/nas/x']);
    expect(parseArgs(['--no-progress', 'hd3']).flags).toEqual({ 'no-progress': true });
  });

  it('trailing flag with no value is boolean', () => {
    expect(parseArgs(['x', '--notes']).flags).toEqual({ notes: true });
  });
});
