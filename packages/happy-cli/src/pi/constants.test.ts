import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';

import { buildPiAcpEnv, findPiBin, PI_ACP_PI_COMMAND_ENV, resolvePiAcpCommand } from './constants';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

const mockedExecSync = vi.mocked(execSync);

const ENV_KEYS = ['HAPPY_PI_PATH', PI_ACP_PI_COMMAND_ENV] as const;

describe('pi binary resolution', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    mockedExecSync.mockReset();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not on PATH');
    });
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('prefers the HAPPY_PI_PATH override above every other source', () => {
    process.env.HAPPY_PI_PATH = '/opt/pi/bin/pi';
    process.env[PI_ACP_PI_COMMAND_ENV] = '/from/pi-acp/pi';
    mockedExecSync.mockReturnValue('/usr/local/bin/pi\n' as never);

    expect(findPiBin()).toBe('/opt/pi/bin/pi');
  });

  it('returns the PATH hit rather than the bare command name', () => {
    mockedExecSync.mockReturnValue('/usr/local/bin/pi\n' as never);

    expect(findPiBin()).toBe('/usr/local/bin/pi');
  });

  it('takes the first line when several binaries match', () => {
    mockedExecSync.mockReturnValue('C:\\Pi\\pi.exe\r\nC:\\Other\\pi.exe\r\n' as never);

    expect(findPiBin()).toBe('C:\\Pi\\pi.exe');
  });

  it('falls back to PI_ACP_PI_COMMAND when pi is not on PATH', () => {
    process.env[PI_ACP_PI_COMMAND_ENV] = 'D:/tools/pi-windows-x64/pi.exe';

    expect(findPiBin()).toBe('D:/tools/pi-windows-x64/pi.exe');
  });

  it('reports nothing found when neither PATH nor the override has an answer', () => {
    expect(findPiBin()).toBeUndefined();
  });
});

describe('buildPiAcpEnv', () => {
  let savedCommand: string | undefined;
  let savedOverride: string | undefined;

  beforeEach(() => {
    mockedExecSync.mockReset();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not on PATH');
    });
    savedCommand = process.env[PI_ACP_PI_COMMAND_ENV];
    savedOverride = process.env.HAPPY_PI_PATH;
    delete process.env[PI_ACP_PI_COMMAND_ENV];
    delete process.env.HAPPY_PI_PATH;
  });

  afterEach(() => {
    if (savedCommand === undefined) {
      delete process.env[PI_ACP_PI_COMMAND_ENV];
    } else {
      process.env[PI_ACP_PI_COMMAND_ENV] = savedCommand;
    }
    if (savedOverride === undefined) {
      delete process.env.HAPPY_PI_PATH;
    } else {
      process.env.HAPPY_PI_PATH = savedOverride;
    }
  });

  it('points the adapter at the resolved binary', () => {
    mockedExecSync.mockReturnValue('/usr/local/bin/pi\n' as never);

    expect(buildPiAcpEnv()).toEqual({ [PI_ACP_PI_COMMAND_ENV]: '/usr/local/bin/pi' });
  });

  it('leaves an explicit PI_ACP_PI_COMMAND alone', () => {
    process.env[PI_ACP_PI_COMMAND_ENV] = '/chosen/by/the/user/pi';
    mockedExecSync.mockReturnValue('/usr/local/bin/pi\n' as never);

    expect(buildPiAcpEnv()).toEqual({});
  });

  it('adds nothing when pi cannot be located, so the adapter reports it', () => {
    expect(buildPiAcpEnv()).toEqual({});
  });
});

describe('resolvePiAcpCommand', () => {
  beforeEach(() => {
    mockedExecSync.mockReset();
  });

  it('spawns a globally-installed adapter binary directly', () => {
    mockedExecSync.mockReturnValue('/usr/local/bin/pi-acp\n' as never);

    expect(resolvePiAcpCommand()).toEqual({ command: '/usr/local/bin/pi-acp', args: [] });
  });

  it('falls back to npx when the adapter is not on PATH', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(resolvePiAcpCommand()).toEqual({ command: 'npx', args: ['-y', 'pi-acp@0.0.33'] });
  });

  it('takes the first match when several binaries are on PATH', () => {
    mockedExecSync.mockReturnValue('/a/pi-acp\n/b/pi-acp\n' as never);

    expect(resolvePiAcpCommand()).toEqual({ command: '/a/pi-acp', args: [] });
  });
});
