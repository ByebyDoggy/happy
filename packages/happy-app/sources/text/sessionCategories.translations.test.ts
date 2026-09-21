import { describe, expect, it } from 'vitest';
import { en } from './_default';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';
import { ru } from './translations/ru';
import { ja } from './translations/ja';
import { pl } from './translations/pl';
import { es } from './translations/es';
// The Italian translations are exported as `it`, which would shadow vitest's
// `it` in this file and break every `it(...)` call below.
import { it as italian } from './translations/it';
import { pt } from './translations/pt';
import { ca } from './translations/ca';

/**
 * A parameterised translation must interpolate, and the failure mode is silent:
 * a plain string written where a function belongs renders `{categories}`
 * verbatim to the user, and nothing else in the suite notices. These strings
 * are generated per language, so this is the test that catches it.
 */
const TRANSLATIONS = { en, zhHans, zhHant, ru, ja, pl, es, it: italian, pt, ca };

describe('sessionCategories.deleteMessage', () => {
    it.each(Object.entries(TRANSLATIONS))('%s interpolates both counts', (_name, translation) => {
        const message = translation.sessionCategories.deleteMessage({ categories: 3, sessions: 7 });

        expect(message).toContain('3');
        expect(message).toContain('7');
        expect(message).not.toContain('{');
        expect(message).not.toContain('}');
    });

    it.each(Object.entries(TRANSLATIONS))('%s reads as a sentence', (_name, translation) => {
        const message = translation.sessionCategories.deleteMessage({ categories: 1, sessions: 1 });

        expect(message.length).toBeGreaterThan(10);
    });
});

describe('sessionCategories.emptyBody', () => {
    // Same failure mode as deleteMessage: a parameterised string written as a
    // plain literal renders `${name}` or `{name}` verbatim, and only the
    // rendered output would reveal it.
    it.each(Object.entries(TRANSLATIONS))('%s interpolates the category name', (_name, translation) => {
        const message = translation.sessionCategories.emptyBody({ name: 'GameDev' });

        expect(message).toContain('GameDev');
        expect(message).not.toContain('${name}');
        expect(message).not.toContain('{name}');
    });
});

describe('sessionCategories static labels', () => {
    const labelKeys = [
        'title',
        'all',
        'uncategorised',
        'create',
        'rename',
        'createChild',
        'delete',
        'nameLabel',
        'moveTo',
        'none',
        'deleteTitle',
        'deleteConfirm',
    ] as const;

    it.each(Object.entries(TRANSLATIONS))('%s defines every label', (_name, translation) => {
        for (const key of labelKeys) {
            const value = translation.sessionCategories[key];
            expect(typeof value, `${key} should be a string`).toBe('string');
            expect((value as string).length, `${key} should not be empty`).toBeGreaterThan(0);
        }
    });
});
