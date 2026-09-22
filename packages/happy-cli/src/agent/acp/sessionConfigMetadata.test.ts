import { describe, expect, it } from 'vitest';
import type { Metadata } from '@/api/types';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import {
  extractConfigOptionsFromPayload,
  mergeAcpSessionConfigIntoMetadata,
} from './sessionConfigMetadata';

function createBaseMetadata(): Metadata {
  return {
    path: '/repo',
    host: 'host',
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happy',
    happyLibDir: '/repo/.happy/lib',
    happyToolsDir: '/repo/.happy/tools',
  };
}

function selectOption(input: {
  id: string;
  name: string;
  category: string;
  currentValue: string;
  options: Array<{ value: string; name: string; description?: string | null }>;
}): SessionConfigOption {
  return {
    type: 'select',
    id: input.id,
    name: input.name,
    category: input.category,
    currentValue: input.currentValue,
    options: input.options,
  };
}

describe('sessionConfigMetadata', () => {
  it('maps supported ACP config option categories into metadata', () => {
    const metadata = createBaseMetadata();
    const configOptions: SessionConfigOption[] = [
      selectOption({
        id: 'session_mode',
        name: 'Mode',
        category: 'mode',
        currentValue: 'code',
        options: [
          { value: 'ask', name: 'Ask', description: 'Q&A only' },
          { value: 'code', name: 'Code', description: 'Write and edit files' },
        ],
      }),
      selectOption({
        id: 'session_model',
        name: 'Model',
        category: 'model',
        currentValue: 'claude-sonnet',
        options: [
          { value: 'claude-sonnet', name: 'Claude Sonnet', description: 'Balanced model' },
          { value: 'claude-opus', name: 'Claude Opus', description: 'High reasoning quality' },
        ],
      }),
      selectOption({
        id: 'reasoning_depth',
        name: 'Thought Level',
        category: 'thought_level',
        currentValue: 'medium',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      }),
      selectOption({
        id: 'custom',
        name: 'Custom',
        category: '_custom',
        currentValue: 'x',
        options: [{ value: 'x', name: 'X' }],
      }),
    ];

    const next = mergeAcpSessionConfigIntoMetadata(metadata, { configOptions });

    expect(next.operatingModes).toEqual([
      { code: 'ask', value: 'Ask', description: 'Q&A only' },
      { code: 'code', value: 'Code', description: 'Write and edit files' },
    ]);
    expect(next.currentOperatingModeCode).toBe('code');

    expect(next.models).toEqual([
      { code: 'claude-sonnet', value: 'Claude Sonnet', description: 'Balanced model' },
      { code: 'claude-opus', value: 'Claude Opus', description: 'High reasoning quality' },
    ]);
    expect(next.currentModelCode).toBe('claude-sonnet');

    expect(next.thoughtLevels).toEqual([
      { code: 'low', value: 'Low' },
      { code: 'medium', value: 'Medium' },
      { code: 'high', value: 'High' },
    ]);
    expect(next.currentThoughtLevelCode).toBe('medium');
  });

  it('falls back to legacy modes/models when configOptions are not present', () => {
    const metadata = createBaseMetadata();

    const next = mergeAcpSessionConfigIntoMetadata(metadata, {
      modes: {
        availableModes: [
          { id: 'ask', name: 'Ask', description: 'Ask mode' },
          { id: 'code', name: 'Code', description: 'Code mode' },
        ],
        currentModeId: 'ask',
      },
      models: {
        availableModels: [
          { modelId: 'm1', name: 'Model 1', description: 'Fast' },
          { modelId: 'm2', name: 'Model 2', description: 'Reasoning' },
        ],
        currentModelId: 'm2',
      },
    });

    expect(next.operatingModes).toEqual([
      { code: 'ask', value: 'Ask', description: 'Ask mode' },
      { code: 'code', value: 'Code', description: 'Code mode' },
    ]);
    expect(next.currentOperatingModeCode).toBe('ask');
    expect(next.models).toEqual([
      { code: 'm1', value: 'Model 1', description: 'Fast' },
      { code: 'm2', value: 'Model 2', description: 'Reasoning' },
    ]);
    expect(next.currentModelCode).toBe('m2');
  });

  it('prefers configOptions mode/model selectors over legacy mode/model state', () => {
    const metadata = createBaseMetadata();

    const next = mergeAcpSessionConfigIntoMetadata(metadata, {
      configOptions: [
        selectOption({
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          currentValue: 'code',
          options: [{ value: 'code', name: 'Code' }],
        }),
        selectOption({
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'new-model',
          options: [{ value: 'new-model', name: 'New Model' }],
        }),
      ],
      modes: {
        availableModes: [{ id: 'ask', name: 'Ask' }],
        currentModeId: 'ask',
      },
      models: {
        availableModels: [{ modelId: 'legacy-model', name: 'Legacy Model' }],
        currentModelId: 'legacy-model',
      },
    });

    expect(next.operatingModes).toEqual([{ code: 'code', value: 'Code' }]);
    expect(next.currentOperatingModeCode).toBe('code');
    expect(next.models).toEqual([{ code: 'new-model', value: 'New Model' }]);
    expect(next.currentModelCode).toBe('new-model');
  });

  // pi-acp publishes its thinking levels twice: as a `thought_level` config
  // option, and again through the legacy modes channel. The legacy channel is
  // for real session modes, so a verbatim copy must not reach operatingModes —
  // the app rendered it as permission modes ("off / minimal / … / xhigh") and
  // selecting one silently changed the reasoning effort instead.
  it('does not publish thinking levels as operating modes when a provider mirrors them into legacy modes', () => {
    const thoughtLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    const asOptions = thoughtLevels.map((value) => ({ value, name: `Thinking: ${value}` }));

    let next = mergeAcpSessionConfigIntoMetadata(createBaseMetadata(), {
      configOptions: [
        selectOption({
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'm1',
          options: [
            { value: 'm1', name: 'M1' },
            { value: 'm2', name: 'M2' },
          ],
        }),
        selectOption({
          id: 'thought_level',
          name: 'Thinking',
          category: 'thought_level',
          currentValue: 'medium',
          options: asOptions,
        }),
      ],
    });
    // The real event order: config options, then the legacy mirror.
    next = mergeAcpSessionConfigIntoMetadata(next, {
      modes: {
        availableModes: thoughtLevels.map((id) => ({ id, name: `Thinking: ${id}` })),
        currentModeId: 'medium',
      },
    });
    next = mergeAcpSessionConfigIntoMetadata(next, { currentModeId: 'medium' });

    expect(next.operatingModes).toBeUndefined();
    expect(next.currentOperatingModeCode).toBeUndefined();
    expect(next.thoughtLevels?.map((level) => level.code)).toEqual(thoughtLevels);
    expect(next.currentThoughtLevelCode).toBe('medium');
    expect(next.models?.map((model) => model.code)).toEqual(['m1', 'm2']);
    expect(next.currentModelCode).toBe('m1');
  });

  it('keeps legacy modes that are not a copy of the thinking levels', () => {
    let next = mergeAcpSessionConfigIntoMetadata(createBaseMetadata(), {
      configOptions: [
        selectOption({
          id: 'thought_level',
          name: 'Thinking',
          category: 'thought_level',
          currentValue: 'medium',
          options: [
            { value: 'low', name: 'Low' },
            { value: 'medium', name: 'Medium' },
            { value: 'high', name: 'High' },
          ],
        }),
      ],
    });
    next = mergeAcpSessionConfigIntoMetadata(next, {
      modes: {
        availableModes: [
          { id: 'ask', name: 'Ask' },
          { id: 'code', name: 'Code' },
        ],
        currentModeId: 'code',
      },
    });

    expect(next.operatingModes).toEqual([
      { code: 'ask', value: 'Ask' },
      { code: 'code', value: 'Code' },
    ]);
    expect(next.currentOperatingModeCode).toBe('code');
    expect(next.thoughtLevels?.map((level) => level.code)).toEqual(['low', 'medium', 'high']);
  });

  it('clears mirrored modes on the later configOptions event when the mirror arrived first', () => {
    const thoughtLevels = ['low', 'medium', 'high'];

    // Out of order: the legacy mirror lands before the config options, so there
    // is nothing to compare it against yet. The config-options event then finds
    // no `mode` category and deletes the mode slot, which repairs it.
    let next = mergeAcpSessionConfigIntoMetadata(createBaseMetadata(), {
      modes: {
        availableModes: thoughtLevels.map((id) => ({ id, name: id })),
        currentModeId: 'medium',
      },
    });
    expect(next.operatingModes?.map((mode) => mode.code)).toEqual(thoughtLevels);

    next = mergeAcpSessionConfigIntoMetadata(next, {
      configOptions: [
        selectOption({
          id: 'thought_level',
          name: 'Thinking',
          category: 'thought_level',
          currentValue: 'medium',
          options: thoughtLevels.map((value) => ({ value, name: value })),
        }),
      ],
    });

    expect(next.operatingModes).toBeUndefined();
    expect(next.currentOperatingModeCode).toBeUndefined();
    expect(next.thoughtLevels?.map((level) => level.code)).toEqual(thoughtLevels);
  });

  it('extracts configOptions payload from either array or wrapped object', () => {
    const option = selectOption({
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: 'm',
      options: [{ value: 'm', name: 'Model' }],
    });

    expect(extractConfigOptionsFromPayload([option])).toEqual([option]);
    expect(extractConfigOptionsFromPayload({ configOptions: [option] })).toEqual([option]);
    expect(extractConfigOptionsFromPayload({})).toBeNull();
  });
});
