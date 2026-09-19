import { describe, expect, it } from 'vitest';
import {
    addCategory,
    assignSessionToCategory,
    buildCategoryNodes,
    canMoveCategory,
    collectSubtreeIds,
    deleteCategory,
    getCategoryDepth,
    getCategoryPath,
    getDescendantIds,
    moveCategory,
    pruneSessionAssignments,
    renameCategory,
    sanitizeSessionCategoryTree,
    setCategoryOrder,
} from './sessionCategoryOps';
import type { SessionCategory, SessionCategoryTree } from './sessionCategories';

function category(
    id: string,
    parentId: string | null = null,
    order = 0,
    name = id,
): SessionCategory {
    return { id, name, parentId, order };
}

function tree(
    categories: SessionCategory[],
    assignments: Record<string, string> = {},
): SessionCategoryTree {
    return { categories, assignments };
}

/**
 * game
 * ├── game-2d
 * └── game-3d
 * web
 */
const SAMPLE = tree(
    [
        category('game', null, 0),
        category('game-2d', 'game', 0),
        category('game-3d', 'game', 1),
        category('web', null, 1),
    ],
    { s1: 'game-2d', s2: 'game-2d', s3: 'game', s4: 'web' },
);

describe('getCategoryDepth', () => {
    it('counts a root as one level', () => {
        expect(getCategoryDepth(SAMPLE.categories, 'game')).toBe(1);
        expect(getCategoryDepth(SAMPLE.categories, 'web')).toBe(1);
    });

    it('counts a child as two levels', () => {
        expect(getCategoryDepth(SAMPLE.categories, 'game-2d')).toBe(2);
    });

    it('reports zero for an id that is not in the tree', () => {
        expect(getCategoryDepth(SAMPLE.categories, 'missing')).toBe(0);
    });

    it('terminates on a cycle instead of hanging', () => {
        // Corruption that survived a sync: a is b's parent and b is a's.
        const cyclic = [category('a', 'b'), category('b', 'a')];
        expect(getCategoryDepth(cyclic, 'a')).toBeLessThanOrEqual(2);
    });
});

describe('getDescendantIds', () => {
    it('returns children and grandchildren, not the category itself', () => {
        expect(getDescendantIds(SAMPLE.categories, 'game').sort())
            .toEqual(['game-2d', 'game-3d']);
    });

    it('returns nothing for a leaf', () => {
        expect(getDescendantIds(SAMPLE.categories, 'game-2d')).toEqual([]);
    });

    it('walks several levels', () => {
        const deep = [
            category('a'),
            category('b', 'a'),
            category('c', 'b'),
        ];
        expect(getDescendantIds(deep, 'a').sort()).toEqual(['b', 'c']);
    });
});

describe('buildCategoryNodes', () => {
    it('nests children under their parent', () => {
        const roots = buildCategoryNodes(SAMPLE);

        expect(roots.map(node => node.category.id)).toEqual(['game', 'web']);
        expect(roots[0].children.map(node => node.category.id)).toEqual(['game-2d', 'game-3d']);
    });

    it('counts sessions filed directly at each node', () => {
        const roots = buildCategoryNodes(SAMPLE);

        expect(roots[0].directCount).toBe(1);
        expect(roots[0].children[0].directCount).toBe(2);
    });

    it('rolls child counts into the parent total', () => {
        const roots = buildCategoryNodes(SAMPLE);

        // game holds s3 itself, plus s1 and s2 in game-2d.
        expect(roots[0].totalCount).toBe(3);
        expect(roots[1].totalCount).toBe(1);
    });

    it('orders siblings by order, then by name', () => {
        const ordered = tree([
            category('b', null, 2, 'b'),
            category('a', null, 1, 'a'),
            category('c', null, 3, 'c'),
        ]);

        expect(buildCategoryNodes(ordered).map(node => node.category.id)).toEqual(['a', 'b', 'c']);
    });

    it('breaks an order tie by name', () => {
        const tied = tree([
            category('zeb', null, 1, 'zeb'),
            category('alp', null, 1, 'alp'),
        ]);

        expect(buildCategoryNodes(tied).map(node => node.category.id)).toEqual(['alp', 'zeb']);
    });

    it('promotes a category whose parent is gone to a root', () => {
        // The parent was deleted on another device and the sync landed here.
        const orphaned = tree([category('lost', 'vanished')]);

        expect(buildCategoryNodes(orphaned).map(node => node.category.id)).toEqual(['lost']);
    });

    it('returns nothing for an empty tree', () => {
        expect(buildCategoryNodes(tree([]))).toEqual([]);
    });
});

describe('canMoveCategory', () => {
    it('allows moving a leaf under a different root', () => {
        expect(canMoveCategory(SAMPLE.categories, 'game-3d', 'web')).toBe(true);
    });

    it('allows promoting a child to a root', () => {
        expect(canMoveCategory(SAMPLE.categories, 'game-2d', null)).toBe(true);
    });

    it('refuses to make a category its own parent', () => {
        expect(canMoveCategory(SAMPLE.categories, 'game', 'game')).toBe(false);
    });

    it('refuses to move a category under its own descendant', () => {
        expect(canMoveCategory(SAMPLE.categories, 'game', 'game-2d')).toBe(false);
    });

    it('refuses a parent that does not exist', () => {
        expect(canMoveCategory(SAMPLE.categories, 'game-3d', 'missing')).toBe(false);
    });

    describe('depth cap', () => {
        // a → b → c is three levels, which is the cap.
        const deep = tree([
            category('a'),
            category('b', 'a'),
            category('c', 'b'),
            category('leaf'),
        ]);

        it('allows a leaf to fill the last level', () => {
            // `b` sits at depth 2, so `leaf` under it lands exactly on 3.
            expect(canMoveCategory(deep.categories, 'leaf', 'b')).toBe(true);
        });

        it('refuses a leaf below the deepest level', () => {
            // `c` is already depth 3; `leaf` under it would be depth 4.
            expect(canMoveCategory(deep.categories, 'leaf', 'c')).toBe(false);
        });

        it('measures the moved subtree, not just the node', () => {
            // `b` carries `c` with it, so the pair needs two free levels.
            expect(canMoveCategory(deep.categories, 'b', 'c')).toBe(false);
        });

        it('refuses to bury a whole branch under a leaf', () => {
            expect(canMoveCategory(SAMPLE.categories, 'game', 'game-3d')).toBe(false);
        });
    });
});

describe('addCategory', () => {
    it('appends a new category', () => {
        const next = addCategory(tree([]), category('game'));

        expect(next.categories.map(c => c.id)).toEqual(['game']);
    });

    it('ignores a duplicate id', () => {
        const before = tree([category('game', null, 0, 'Game')]);
        const next = addCategory(before, category('game', null, 5, 'Other'));

        expect(next).toBe(before);
    });

    it('leaves the original tree untouched', () => {
        const before = tree([category('game')]);
        addCategory(before, category('web'));

        expect(before.categories).toHaveLength(1);
    });
});

describe('renameCategory', () => {
    it('renames only the target', () => {
        const next = renameCategory(SAMPLE, 'game-2d', 'Pixel art');

        expect(next.categories.find(c => c.id === 'game-2d')?.name).toBe('Pixel art');
        expect(next.categories.find(c => c.id === 'game')?.name).toBe('game');
    });

    it('leaves the original untouched', () => {
        renameCategory(SAMPLE, 'game', 'Renamed');

        expect(SAMPLE.categories.find(c => c.id === 'game')?.name).toBe('game');
    });
});

describe('moveCategory', () => {
    it('re-parents a category that may move', () => {
        const next = moveCategory(SAMPLE, 'game-3d', 'web');

        expect(next.categories.find(c => c.id === 'game-3d')?.parentId).toBe('web');
    });

    it('returns the same tree when the move is forbidden', () => {
        expect(moveCategory(SAMPLE, 'game', 'game-2d')).toBe(SAMPLE);
    });
});

describe('setCategoryOrder', () => {
    it('sets the order on the target only', () => {
        const next = setCategoryOrder(SAMPLE, 'web', 0);

        expect(next.categories.find(c => c.id === 'web')?.order).toBe(0);
        expect(next.categories.find(c => c.id === 'game')?.order).toBe(0);
    });
});

describe('deleteCategory', () => {
    it('removes the category and its descendants', () => {
        const next = deleteCategory(SAMPLE, 'game');

        expect(next.categories.map(c => c.id)).toEqual(['web']);
    });

    it('unfiles every session that was in the removed subtree', () => {
        const next = deleteCategory(SAMPLE, 'game');

        // s3 was on game, s1 and s2 under game-2d; only s4's web survives.
        expect(next.assignments).toEqual({ s4: 'web' });
    });

    it('leaves a sibling subtree alone', () => {
        const next = deleteCategory(SAMPLE, 'game-2d');

        expect(next.categories.map(c => c.id)).toEqual(['game', 'game-3d', 'web']);
        expect(next.assignments).toEqual({ s3: 'game', s4: 'web' });
    });

    it('is a no-op for an unknown id', () => {
        const next = deleteCategory(SAMPLE, 'missing');

        expect(next.categories).toHaveLength(SAMPLE.categories.length);
        expect(next.assignments).toEqual(SAMPLE.assignments);
    });
});

describe('assignSessionToCategory', () => {
    it('files a session under a category', () => {
        const next = assignSessionToCategory(SAMPLE, 's9', 'web');

        expect(next.assignments.s9).toBe('web');
    });

    it('moves a session between categories', () => {
        const next = assignSessionToCategory(SAMPLE, 's1', 'web');

        expect(next.assignments.s1).toBe('web');
    });

    it('unfiles a session when given null', () => {
        const next = assignSessionToCategory(SAMPLE, 's3', null);

        expect(next.assignments.s3).toBeUndefined();
    });

    it('refuses a category that does not exist', () => {
        const next = assignSessionToCategory(SAMPLE, 's9', 'missing');

        expect(next.assignments.s9).toBeUndefined();
    });

    it('leaves the original untouched', () => {
        assignSessionToCategory(SAMPLE, 's9', 'web');

        expect(SAMPLE.assignments.s9).toBeUndefined();
    });

    it('keeps a session in one category only', () => {
        const next = assignSessionToCategory(
            assignSessionToCategory(SAMPLE, 's9', 'web'),
            's9',
            'game',
        );

        expect(Object.values(next.assignments).filter(id => id === 'game')).toHaveLength(2);
        expect(next.assignments.s9).toBe('game');
    });
});

describe('pruneSessionAssignments', () => {
    it('drops assignments for sessions that no longer exist', () => {
        const next = pruneSessionAssignments(SAMPLE, new Set(['s1', 's4']));

        expect(next.assignments).toEqual({ s1: 'game-2d', s4: 'web' });
    });

    it('returns the same tree when nothing was deleted', () => {
        const live = new Set(Object.keys(SAMPLE.assignments));

        expect(pruneSessionAssignments(SAMPLE, live)).toBe(SAMPLE);
    });

    it('keeps categories even when nothing is filed under them', () => {
        const next = pruneSessionAssignments(SAMPLE, new Set());

        expect(next.categories).toHaveLength(4);
        expect(next.assignments).toEqual({});
    });
});

describe('getCategoryPath', () => {
    it('returns the chain from root to the session’s category', () => {
        expect(getCategoryPath(SAMPLE, 's1').map(c => c.id)).toEqual(['game', 'game-2d']);
    });

    it('returns a single entry for a session on a root', () => {
        expect(getCategoryPath(SAMPLE, 's4').map(c => c.id)).toEqual(['web']);
    });

    it('returns nothing for an uncategorised session', () => {
        expect(getCategoryPath(SAMPLE, 'nobody')).toEqual([]);
    });
});

describe('collectSubtreeIds', () => {
    it('includes the category itself', () => {
        expect(collectSubtreeIds(SAMPLE, 'game').sort()).toEqual(['game', 'game-2d', 'game-3d']);
    });
});

describe('sanitizeSessionCategoryTree', () => {
    it('drops a duplicate id', () => {
        const dirty = tree([category('a', null, 0, 'First'), category('a', null, 1, 'Second')]);

        expect(sanitizeSessionCategoryTree(dirty).categories).toHaveLength(1);
    });

    it('promotes an orphan to a root', () => {
        const dirty = tree([category('child', 'gone')]);

        expect(sanitizeSessionCategoryTree(dirty).categories[0].parentId).toBeNull();
    });

    it('breaks a two-node cycle', () => {
        const dirty = tree([category('a', 'b'), category('b', 'a')]);
        const clean = sanitizeSessionCategoryTree(dirty);

        expect(clean.categories.some(c => c.parentId === null)).toBe(true);
    });

    it('unfiles assignments pointing at a category that is gone', () => {
        const dirty = tree([category('game')], { s1: 'game', s2: 'vanished' });

        expect(sanitizeSessionCategoryTree(dirty).assignments).toEqual({ s1: 'game' });
    });

    it('leaves a healthy tree intact', () => {
        const clean = sanitizeSessionCategoryTree(SAMPLE);

        expect(clean.categories).toHaveLength(4);
        expect(clean.assignments).toEqual(SAMPLE.assignments);
    });

    it('returns an empty tree for empty input', () => {
        expect(sanitizeSessionCategoryTree(tree([]))).toEqual({ categories: [], assignments: {} });
    });
});
