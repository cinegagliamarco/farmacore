import { execFile } from 'node:child_process';
import { runTenantMigration } from './run-tenant-migration';

jest.mock('node:child_process', () => ({
  // promisify() appends a callback; resolve with the {stdout, stderr}
  // shape the real execFile promisify-custom returns.
  execFile: jest.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: 'migrated', stderr: '' }),
  ),
}));

const execFileMock = execFile as unknown as jest.Mock;

describe('runTenantMigration', () => {
  beforeEach(() => execFileMock.mockClear());

  it.each([
    'Acme', // uppercase
    'a', // too short
    '9acme', // starts with digit
    '-acme', // starts with dash
    'acme_pharma', // underscore
    'acme; rm -rf /', // injection attempt
    'a'.repeat(64), // too long
    '',
  ])('rejects invalid slug %j without spawning a child', async (slug) => {
    await expect(runTenantMigration(slug)).rejects.toThrow(
      'Invalid tenant slug',
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('runs the migration with array args (no shell) and a 64 MiB maxBuffer', async () => {
    const out = await runTenantMigration('acme-pharma');
    expect(out).toEqual({ stdout: 'migrated', stderr: '' });
    expect(execFileMock).toHaveBeenCalledWith(
      'npm',
      ['run', 'migration:tenant', 'acme-pharma'],
      { maxBuffer: 64 * 1024 * 1024 },
      expect.any(Function),
    );
  });
});
