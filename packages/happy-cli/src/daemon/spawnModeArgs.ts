import type { SpawnSessionOptions } from '@/modules/common/registerCommonHandlers';

export function shouldForwardDaemonPermissionMode(
  agent: string,
  permissionMode: string | undefined,
): permissionMode is string {
  if (!permissionMode) return false;

  // Claude's "default" means no harness override. Codex's "default" is a
  // concrete ask-first execution policy and differs from its ambient "auto".
  return permissionMode !== 'default' || agent === 'codex';
}

/**
 * Build the argument vector for a daemon-spawned agent.
 *
 * Most agents are a Happy subcommand that takes the shared remote-starting
 * template. Pi is the exception: it runs through the generic ACP runner, which
 * parses its own flags — it takes `--started-by` but has no
 * `--happy-starting-mode`, and it resolves the agent from a positional name.
 * Sending the shared template would make that runner read the unknown flag as
 * the agent name and try to spawn it as a command.
 */
export function buildDaemonSpawnAgentArgs(
  agentCommand: string,
  options: SpawnSessionOptions,
): string[] {
  if (agentCommand === 'pi') {
    return ['acp', '--started-by', 'daemon', 'pi'];
  }

  const args = [
    agentCommand,
    '--happy-starting-mode', 'remote',
    '--started-by', 'daemon',
  ];
  appendDaemonSpawnModeArgs(args, options, agentCommand);
  return args;
}

export function appendDaemonSpawnModeArgs(
  args: string[],
  options: SpawnSessionOptions,
  agent: string,
): void {
  if (agent !== 'claude' && agent !== 'codex') return;

  if (shouldForwardDaemonPermissionMode(agent, options.permissionMode)) {
    args.push('--permission-mode', options.permissionMode);
  }
  if (options.modelMode && options.modelMode !== 'default') {
    args.push('--model', options.modelMode);
  }
  if (options.effortLevel) {
    args.push('--effort', options.effortLevel);
  }
}