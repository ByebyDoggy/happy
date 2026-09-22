/**
 * Pi coding agent constants
 *
 * Pi is driven through the community `pi-acp` adapter: it speaks ACP on stdio
 * and runs `pi --mode rpc` as a child of its own.
 *
 * The adapter resolves that child itself, and on Windows it looks for `pi.cmd`
 * — a name the standalone Pi release never ships (it installs `pi.exe`). When
 * the lookup misses, cmd.exe still reports a successful spawn; the adapter then
 * writes to an already-dead pipe and `session/new` fails with "Cannot call
 * write after a stream was destroyed". Naming the binary explicitly through
 * `PI_ACP_PI_COMMAND` skips that lookup entirely.
 */

import { execSync } from 'node:child_process';

/** Default command name for the pi binary (looked up on PATH). */
export const PI_BIN = 'pi';

/** The npm package that adapts pi to ACP. */
export const PI_ACP_PACKAGE = 'pi-acp';

/**
 * Pinned version for the adapter.
 *
 * The adapter's own README warns to "expect some minor breaking changes", and a
 * daemon spawns it unattended — a silent upstream break would look like Pi
 * hanging rather than a version mismatch. Bump deliberately.
 */
export const PI_ACP_VERSION = '0.0.33';

/** The `npx` spec Happy spawns when it runs the Pi adapter. */
export const PI_ACP_SPEC = `${PI_ACP_PACKAGE}@${PI_ACP_VERSION}`;

/** The agent name the ACP runner resolves to the Pi adapter. */
export const PI_AGENT_NAME = 'pi';

/** Environment variable the pi-acp adapter reads to locate the pi binary. */
export const PI_ACP_PI_COMMAND_ENV = 'PI_ACP_PI_COMMAND';

/**
 * Find the installed pi executable.
 *
 * Resolution order:
 *   1. `HAPPY_PI_PATH` env override — an explicit absolute path.
 *   2. `pi` already resolvable on PATH (the resolved path, not the bare name,
 *      so a daemon started from a non-login shell still finds it).
 *   3. `PI_ACP_PI_COMMAND` — the user already told the adapter where it is.
 *
 * Returns undefined when nothing matched, so the adapter's own lookup runs and
 * its error message is what the user sees.
 */
export function findPiBin(): string | undefined {
  const override = process.env.HAPPY_PI_PATH;
  if (override) {
    return override;
  }

  try {
    const probe = process.platform === 'win32' ? `where ${PI_BIN}` : `command -v ${PI_BIN}`;
    const output = execSync(probe, { encoding: 'utf-8', windowsHide: true });
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (first) {
      return first;
    }
  } catch {
    // Not on PATH — fall through to an explicit override if one exists.
  }

  const configured = process.env[PI_ACP_PI_COMMAND_ENV];
  if (configured) {
    return configured;
  }

  return undefined;
}

/**
 * Environment the pi-acp adapter needs in order to find pi.
 *
 * Returns an empty object when the user has already set the variable — their
 * explicit choice wins over our detection — and when no installation was
 * found, so the adapter's own lookup and error message stand.
 */
export function buildPiAcpEnv(): Record<string, string> {
  if (process.env[PI_ACP_PI_COMMAND_ENV]) {
    return {};
  }

  const bin = findPiBin();
  return bin ? { [PI_ACP_PI_COMMAND_ENV]: bin } : {};
}

/**
 * The spawnable command + args that launch the pi-acp adapter.
 *
 * Prefers a globally-installed `pi-acp` binary (fast, no network) and falls
 * back to `npx -y` so the adapter still works on a machine that has not
 * installed it globally. npx on a cold cache can stall on the download, so a
 * present binary is always better.
 */
export function resolvePiAcpCommand(): { command: string; args: string[] } {
  try {
    const probe = process.platform === 'win32' ? `where ${PI_ACP_PACKAGE}` : `command -v ${PI_ACP_PACKAGE}`;
    const output = execSync(probe, { encoding: 'utf-8', windowsHide: true });
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (first) {
      return { command: first, args: [] };
    }
  } catch {
    // Not on PATH — fall through to npx.
  }
  return { command: 'npx', args: ['-y', PI_ACP_SPEC] };
}
