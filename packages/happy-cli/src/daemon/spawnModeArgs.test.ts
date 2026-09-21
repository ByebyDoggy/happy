import { describe, expect, it } from 'vitest';
import { appendDaemonSpawnModeArgs, buildDaemonSpawnAgentArgs, shouldForwardDaemonPermissionMode } from './spawnModeArgs';

describe('daemon spawn mode arguments', () => {
  it('forwards Codex default because it is a concrete ask-first policy', () => {
    const args: string[] = [];

    appendDaemonSpawnModeArgs(args, { directory: '/repo', permissionMode: 'default' }, 'codex');

    expect(args).toEqual(['--permission-mode', 'default']);
  });

  it('leaves Claude default ambient', () => {
    const args: string[] = [];

    appendDaemonSpawnModeArgs(args, { directory: '/repo', permissionMode: 'default' }, 'claude');

    expect(args).toEqual([]);
  });

  it('forwards explicit Codex permission, model, and effort selections', () => {
    const args: string[] = [];

    appendDaemonSpawnModeArgs(args, {
      directory: '/repo',
      permissionMode: 'yolo',
      modelMode: 'gpt-5.6-sol',
      effortLevel: 'medium',
    }, 'codex');

    expect(args).toEqual([
      '--permission-mode', 'yolo',
      '--model', 'gpt-5.6-sol',
      '--effort', 'medium',
    ]);
  });

  it('uses the same Codex default rule for resume launches', () => {
    expect(shouldForwardDaemonPermissionMode('codex', 'default')).toBe(true);
    expect(shouldForwardDaemonPermissionMode('claude', 'default')).toBe(false);
  });
});

describe('daemon spawn agent arguments', () => {
  it('spawns Claude with the starting-mode flag', () => {
    expect(buildDaemonSpawnAgentArgs('claude', { directory: '/repo' })).toEqual([
      'claude',
      '--happy-starting-mode', 'remote',
      '--started-by', 'daemon',
    ]);
  });

  it('routes pi through the ACP runner instead of the native template', () => {
    // The ACP runner has no --happy-starting-mode; sending it would make the
    // runner treat that flag as the agent name and spawn it as a command.
    expect(buildDaemonSpawnAgentArgs('pi', { directory: '/repo' })).toEqual([
      'acp',
      '--started-by', 'daemon',
      'pi',
    ]);
  });

  it('does not forward permission mode to pi, which has no such flag', () => {
    const args = buildDaemonSpawnAgentArgs('pi', {
      directory: '/repo',
      permissionMode: 'yolo',
      modelMode: 'claude-opus-4-8',
      effortLevel: 'high',
    });

    expect(args).toEqual(['acp', '--started-by', 'daemon', 'pi']);
  });

  it('still forwards mode selections to agents that accept them', () => {
    const args = buildDaemonSpawnAgentArgs('codex', {
      directory: '/repo',
      permissionMode: 'yolo',
    });

    expect(args).toEqual([
      'codex',
      '--happy-starting-mode', 'remote',
      '--started-by', 'daemon',
      '--permission-mode', 'yolo',
    ]);
  });
});
