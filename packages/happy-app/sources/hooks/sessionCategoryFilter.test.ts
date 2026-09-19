import { describe, expect, it } from 'vitest';
import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import type { SessionCategory, SessionCategoryTree } from '@/sync/sessionCategories';
import {
    UNCATEGORISED_FILTER,
    collectAssignedSessionIds,
    countSessionsInCategory,
    filterSessionListByCategory,
    isKnownCategory,
} from './sessionCategoryFilter';

function row(id: string): SessionRowData {
    return { id, name: id, active: false, archived: false } as SessionRowData;
}

function category(id: string, parentId: string | null = null): SessionCategory {
    return { id, name: id, parentId, order: 0 };
}

/**
 * game
 * └── game-2d
 * web
 */
const TREE: SessionCategoryTree = {
    categories: [category('game'), category('game-2d', 'game'), category('web')],
    assignments: { s1: 'game-2d', s2: 'game', s3: 'web' },
};

function session(id: string): SessionListViewItem {
    return { type: 'session', session: row(id) };
}

function project(id: string, sessionIds: string[]): SessionListViewItem {
    return {
        type: 'project',
        source: 'happy',
        project: {
            id,
            name: id,
            machineId: 'm1',
            sessionCount: sessionIds.length,
            activeCount: 0,
            workspaces: [{ id: '', name: null, sessions: sessionIds.map(row) }],
        },
    };
}

function flatSessionIds(items: SessionListViewItem[]): string[] {
    return items.flatMap(item => (item.type === 'session' ? [item.session.id] : []));
}

function projectSessionIds(items: SessionListViewItem[]): string[] {
    return items.flatMap(item => (item.type === 'project'
        ? item.project.workspaces.flatMap(workspace => workspace.sessions.map(s => s.id))
        : []));
}

describe('collectAssignedSessionIds', () => {
    it('includes sessions under the category and below it', () => {
        expect([...collectAssignedSessionIds(TREE, 'game')].sort()).toEqual(['s1', 's2']);
    });

    it('returns only the category’s own sessions for a leaf', () => {
        expect([...collectAssignedSessionIds(TREE, 'game-2d')]).toEqual(['s1']);
    });

    it('returns nothing for a category no session is filed under', () => {
        const empty = { ...TREE, assignments: {} };

        expect(collectAssignedSessionIds(empty, 'game').size).toBe(0);
    });
});

describe('isKnownCategory', () => {
    it('recognises a real category', () => {
        expect(isKnownCategory(TREE, 'game')).toBe(true);
    });

    it('recognises the uncategorised sentinel', () => {
        expect(isKnownCategory(TREE, UNCATEGORISED_FILTER)).toBe(true);
    });

    it('rejects an id the tree does not hold', () => {
        expect(isKnownCategory(TREE, 'gone')).toBe(false);
    });
});

describe('countSessionsInCategory', () => {
    it('counts the subtree', () => {
        expect(countSessionsInCategory(TREE, 'game')).toBe(2);
    });

    it('counts one category on its own', () => {
        expect(countSessionsInCategory(TREE, 'web')).toBe(1);
    });

    it('counts zero for an empty category', () => {
        expect(countSessionsInCategory({ ...TREE, assignments: {} }, 'game')).toBe(0);
    });
});

describe('filterSessionListByCategory', () => {
    it('returns the list untouched when no filter is set', () => {
        const items = [session('s1'), session('s3')];

        expect(filterSessionListByCategory(items, TREE, null)).toBe(items);
    });

    it('keeps only sessions under the chosen category', () => {
        const items = [session('s1'), session('s3')];

        expect(flatSessionIds(filterSessionListByCategory(items, TREE, 'game-2d'))).toEqual(['s1']);
    });

    it('includes sub-category sessions when a parent is chosen', () => {
        const items = [session('s1'), session('s2'), session('s3')];

        expect(flatSessionIds(filterSessionListByCategory(items, TREE, 'game'))).toEqual(['s1', 's2']);
    });

    it('keeps only unfiled sessions for the uncategorised sentinel', () => {
        const items = [session('s1'), session('s3'), session('loose')];

        expect(flatSessionIds(filterSessionListByCategory(items, TREE, UNCATEGORISED_FILTER)))
            .toEqual(['loose']);
    });

    it('admits nothing when the chosen category no longer exists', () => {
        const items = [session('s1'), session('s3')];

        expect(filterSessionListByCategory(items, TREE, 'deleted-on-another-device')).toEqual([]);
    });

    it('drops a project card left with no matching session', () => {
        const items = [project('p1', ['s3'])];

        expect(filterSessionListByCategory(items, TREE, 'game')).toEqual([]);
    });

    it('keeps a project card and refreshes its counts', () => {
        const items = [project('p1', ['s1', 's3'])];

        const result = filterSessionListByCategory(items, TREE, 'game');

        expect(projectSessionIds(result)).toEqual(['s1']);
        expect(result[0].type === 'project' && result[0].project.sessionCount).toBe(1);
    });

    it('drops project headings, which head cards that were filtered', () => {
        const items: SessionListViewItem[] = [
            { type: 'projects-header', source: 'happy' },
            project('p1', ['s1']),
        ];

        expect(filterSessionListByCategory(items, TREE, 'game').map(item => item.type))
            .toEqual(['project']);
    });

    it('drops a date heading that is not followed by a match', () => {
        const items: SessionListViewItem[] = [
            { type: 'header', title: 'Today' },
            session('s3'),
        ];

        expect(filterSessionListByCategory(items, TREE, 'game')).toEqual([]);
    });

    it('holds a date heading back when nothing under it matches', () => {
        const items: SessionListViewItem[] = [
            { type: 'header', title: 'Today' },
            session('s3'),
        ];

        expect(filterSessionListByCategory(items, TREE, 'game')).toEqual([]);
    });

    it('keeps a date heading once a row under it matches', () => {
        const items: SessionListViewItem[] = [
            { type: 'header', title: 'Today' },
            session('s1'),
        ];

        const result = filterSessionListByCategory(items, TREE, 'game');

        expect(result.map(item => item.type)).toEqual(['header', 'session']);
    });

    it('filters the active-sessions group and drops it when emptied', () => {
        const items: SessionListViewItem[] = [
            { type: 'active-sessions', sessions: [row('s3')] },
            { type: 'active-sessions', sessions: [row('s1')] },
        ];

        const result = filterSessionListByCategory(items, TREE, 'game');

        expect(result).toHaveLength(1);
        expect(result[0].type === 'active-sessions' && result[0].sessions.map(s => s.id))
            .toEqual(['s1']);
    });

    it('filters the bots group', () => {
        const items: SessionListViewItem[] = [{ type: 'bots', sessions: [row('s1'), row('s3')] }];

        const result = filterSessionListByCategory(items, TREE, 'web');

        expect(result[0].type === 'bots' && result[0].sessions.map(s => s.id)).toEqual(['s3']);
    });

    it('leaves a plain project-group row alone', () => {
        const items: SessionListViewItem[] = [{
            type: 'project-group',
            displayPath: '/a',
            machine: { id: 'm1' } as SessionListViewItem extends { machine: infer M } ? M : never,
        }];

        expect(filterSessionListByCategory(items, TREE, 'game')).toEqual(items);
    });

    it('returns nothing when the tree is empty and a category is chosen', () => {
        const emptyTree: SessionCategoryTree = { categories: [], assignments: {} };

        expect(filterSessionListByCategory([session('s1')], emptyTree, 'game')).toEqual([]);
    });
});
