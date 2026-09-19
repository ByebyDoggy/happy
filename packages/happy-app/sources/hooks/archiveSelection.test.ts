import { describe, expect, it } from 'vitest';
import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import {
    EMPTY_ARCHIVE_SELECTION,
    clearArchiveSelection,
    collectArchivedIds,
    collectArchivedTargets,
    isEveryTargetSelected,
    resolveSelectedTargets,
    setArchiveSelectionFor,
    toggleArchiveSelection,
    type ArchiveSelectionState,
} from './archiveSelection';

// Only the fields the collectors read; real rows are built in storage.ts.
function row(id: string, options: { archived?: boolean; botId?: string | null } = {}): SessionRowData {
    return {
        id,
        name: id,
        archived: options.archived ?? true,
        botId: options.botId ?? null,
    } as SessionRowData;
}

function session(id: string, options?: { archived?: boolean; botId?: string | null }): SessionListViewItem {
    return { type: 'session', session: row(id, options) };
}

function selecting(ids: string[]): ArchiveSelectionState {
    return { selecting: true, selectedIds: new Set(ids) };
}

describe('toggleArchiveSelection', () => {
    it('adds an id that was not selected', () => {
        const next = toggleArchiveSelection(selecting(['a']), 'b');

        expect([...next.selectedIds].sort()).toEqual(['a', 'b']);
    });

    it('removes an id that was already selected', () => {
        const next = toggleArchiveSelection(selecting(['a', 'b']), 'a');

        expect([...next.selectedIds]).toEqual(['b']);
    });

    it('leaves the previous set untouched', () => {
        const before = selecting(['a']);
        const after = toggleArchiveSelection(before, 'b');

        expect([...before.selectedIds]).toEqual(['a']);
        expect(after.selectedIds).not.toBe(before.selectedIds);
    });

    it('preserves selection mode', () => {
        expect(toggleArchiveSelection(selecting([]), 'a').selecting).toBe(true);
    });
});

describe('clearArchiveSelection', () => {
    it('drops the ids and leaves selection mode', () => {
        expect(clearArchiveSelection()).toEqual({
            selecting: false,
            selectedIds: new Set(),
        });
    });

    it('starts from an empty state', () => {
        expect(EMPTY_ARCHIVE_SELECTION.selecting).toBe(false);
        expect(EMPTY_ARCHIVE_SELECTION.selectedIds.size).toBe(0);
    });
});

describe('setArchiveSelectionFor', () => {
    it('adds every id at once', () => {
        const next = setArchiveSelectionFor(selecting(['a']), ['b', 'c'], true);

        expect([...next.selectedIds].sort()).toEqual(['a', 'b', 'c']);
    });

    it('removes every id at once', () => {
        const next = setArchiveSelectionFor(selecting(['a', 'b', 'c']), ['a', 'c'], false);

        expect([...next.selectedIds]).toEqual(['b']);
    });

    it('is a no-op when clearing ids that were not selected', () => {
        const next = setArchiveSelectionFor(selecting(['a']), ['z'], false);

        expect([...next.selectedIds]).toEqual(['a']);
    });

    it('leaves the previous set untouched', () => {
        const before = selecting(['a']);
        setArchiveSelectionFor(before, ['b'], true);

        expect([...before.selectedIds]).toEqual(['a']);
    });
});

describe('collectArchivedTargets', () => {
    it('collects archived rows in list order', () => {
        const targets = collectArchivedTargets([
            session('a'),
            { type: 'header', title: 'Yesterday' },
            session('b'),
        ]);

        expect(targets.map(t => t.id)).toEqual(['a', 'b']);
    });

    it('ignores rows that are not archived', () => {
        const targets = collectArchivedTargets([
            session('live', { archived: false }),
            session('gone'),
        ]);

        expect(targets.map(t => t.id)).toEqual(['gone']);
    });

    it('ignores non-session items entirely', () => {
        const targets = collectArchivedTargets([
            { type: 'header', title: 'Today' },
            { type: 'projects-header', source: 'happy' },
            { type: 'active-sessions', sessions: [row('live', { archived: false })] },
        ]);

        expect(targets).toEqual([]);
    });

    it('marks bots so bulk delete can skip them', () => {
        const targets = collectArchivedTargets([
            session('bot-1', { botId: 'bot-1' }),
            session('plain'),
        ]);

        expect(targets).toEqual([
            { id: 'bot-1', isBot: true },
            { id: 'plain', isBot: false },
        ]);
    });

    it('returns nothing for an empty list', () => {
        expect(collectArchivedTargets([])).toEqual([]);
    });
});

describe('collectArchivedIds', () => {
    it('returns just the ids', () => {
        expect(collectArchivedIds([
            session('a'),
            { type: 'header', title: 'Today' },
            session('b', { botId: 'b' }),
        ])).toEqual(['a', 'b']);
    });
});

describe('resolveSelectedTargets', () => {
    const targets = [
        { id: 'a', isBot: false },
        { id: 'b', isBot: false },
        { id: 'c', isBot: true },
    ];

    it('keeps only the selected rows, in list order', () => {
        expect(resolveSelectedTargets(targets, new Set(['c', 'a'])))
            .toEqual([
                { id: 'a', isBot: false },
                { id: 'c', isBot: true },
            ]);
    });

    it('drops a selected id that is no longer in the list', () => {
        expect(resolveSelectedTargets(targets, new Set(['a', 'vanished'])))
            .toEqual([{ id: 'a', isBot: false }]);
    });

    it('returns nothing when nothing is selected', () => {
        expect(resolveSelectedTargets(targets, new Set())).toEqual([]);
    });
});

describe('isEveryTargetSelected', () => {
    const targets = [
        { id: 'a', isBot: false },
        { id: 'b', isBot: false },
    ];

    it('is true only when every row is ticked', () => {
        expect(isEveryTargetSelected(targets, new Set(['a', 'b']))).toBe(true);
        expect(isEveryTargetSelected(targets, new Set(['a']))).toBe(false);
    });

    it('is false for an empty archive, so the control stays hidden', () => {
        expect(isEveryTargetSelected([], new Set(['a']))).toBe(false);
    });

    it('ignores ids that are not in the list', () => {
        expect(isEveryTargetSelected(targets, new Set(['a']))).toBe(false);
    });
});
