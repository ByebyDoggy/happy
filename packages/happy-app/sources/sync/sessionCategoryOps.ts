import {
    EMPTY_SESSION_CATEGORY_TREE,
    SESSION_CATEGORY_MAX_DEPTH,
    type SessionCategory,
    type SessionCategoryTree,
} from './sessionCategories';

/**
 * Pure operations on the category tree.
 *
 * Everything returns a new tree; nothing mutates its input. The tree is a flat
 * list plus a parent pointer, which keeps every operation a single pass and
 * makes the whole thing testable without a store or a server.
 */

export interface CategoryNode {
    category: SessionCategory;
    children: CategoryNode[];
    /** How many sessions are filed directly under this category. */
    directCount: number;
    /** Direct plus every descendant's, which is the number a header shows. */
    totalCount: number;
}

/** Depth of a category, roots being 1. Zero when the id is unknown. */
export function getCategoryDepth(
    categories: readonly SessionCategory[],
    categoryId: string,
): number {
    const byId = new Map(categories.map(category => [category.id, category]));
    let depth = 0;
    let current = byId.get(categoryId);

    // The `seen` guard keeps a corrupt stored tree (a cycle) from hanging the
    // UI: it is user-generated data that survived a sync, not trusted input.
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        depth += 1;
        current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return depth;
}

/** Every descendant id of `categoryId`, excluding itself. */
export function getDescendantIds(
    categories: readonly SessionCategory[],
    categoryId: string,
): string[] {
    const childrenOf = new Map<string, string[]>();
    for (const category of categories) {
        if (!category.parentId) continue;
        const siblings = childrenOf.get(category.parentId) ?? [];
        siblings.push(category.id);
        childrenOf.set(category.parentId, siblings);
    }

    const descendants: string[] = [];
    const queue = [...(childrenOf.get(categoryId) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        descendants.push(id);
        queue.push(...(childrenOf.get(id) ?? []));
    }
    return descendants;
}

/**
 * Builds the nested view of the tree, with per-node session counts.
 *
 * Ordering is `order` first and name second, so two categories created in the
 * same instant still land in a stable, readable order rather than whatever the
 * server happened to sync first.
 */
export function buildCategoryNodes(tree: SessionCategoryTree): CategoryNode[] {
    const directCounts = new Map<string, number>();
    for (const categoryId of Object.values(tree.assignments)) {
        directCounts.set(categoryId, (directCounts.get(categoryId) ?? 0) + 1);
    }

    const nodes = new Map<string, CategoryNode>();
    for (const category of tree.categories) {
        nodes.set(category.id, {
            category,
            children: [],
            directCount: directCounts.get(category.id) ?? 0,
            totalCount: 0,
        });
    }

    const roots: CategoryNode[] = [];
    for (const category of tree.categories) {
        const node = nodes.get(category.id)!;
        // A category whose parent is missing (deleted on another device) is
        // promoted to a root rather than dropped: losing the label would be
        // worse than losing the nesting.
        const parent = category.parentId ? nodes.get(category.parentId) : undefined;
        if (parent && parent !== node) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    const sortNodes = (list: CategoryNode[]): void => {
        list.sort((a, b) => (
            a.category.order - b.category.order
            || a.category.name.localeCompare(b.category.name)
        ));
        for (const node of list) sortNodes(node.children);
    };
    sortNodes(roots);

    const totalOf = (node: CategoryNode): number => {
        node.totalCount = node.directCount + node.children.reduce((sum, child) => sum + totalOf(child), 0);
        return node.totalCount;
    };
    for (const root of roots) totalOf(root);

    return roots;
}

/**
 * Whether `categoryId` may be re-parented under `newParentId`.
 *
 * Refuses a move that would make a category its own ancestor, and one that
 * would push the deepest descendant past the depth cap. The depth check is on
 * the moved subtree, not just the node: dragging a two-level branch under
 * another two-level branch would otherwise silently create four levels.
 */
export function canMoveCategory(
    categories: readonly SessionCategory[],
    categoryId: string,
    newParentId: string | null,
): boolean {
    if (categoryId === newParentId) return false;
    if (newParentId !== null && !categories.some(category => category.id === newParentId)) {
        return false;
    }
    if (newParentId !== null && getDescendantIds(categories, categoryId).includes(newParentId)) {
        return false;
    }

    const subtreeHeight = getSubtreeHeight(categories, categoryId);
    const newParentDepth = newParentId === null ? 0 : getCategoryDepth(categories, newParentId);
    return newParentDepth + subtreeHeight <= SESSION_CATEGORY_MAX_DEPTH;
}

/** Levels in the subtree rooted at `categoryId`, the category itself counting as one. */
function getSubtreeHeight(
    categories: readonly SessionCategory[],
    categoryId: string,
): number {
    const descendants = getDescendantIds(categories, categoryId);
    if (descendants.length === 0) return 1;

    let height = 1;
    for (const id of descendants) {
        const depth = getCategoryDepth(categories, id) - getCategoryDepth(categories, categoryId) + 1;
        if (depth > height) height = depth;
    }
    return height;
}

export function addCategory(
    tree: SessionCategoryTree,
    category: SessionCategory,
): SessionCategoryTree {
    if (tree.categories.some(existing => existing.id === category.id)) {
        return tree;
    }
    return { ...tree, categories: [...tree.categories, category] };
}

export function renameCategory(
    tree: SessionCategoryTree,
    categoryId: string,
    name: string,
): SessionCategoryTree {
    return {
        ...tree,
        categories: tree.categories.map(category => (
            category.id === categoryId ? { ...category, name } : category
        )),
    };
}

export function moveCategory(
    tree: SessionCategoryTree,
    categoryId: string,
    parentId: string | null,
): SessionCategoryTree {
    if (!canMoveCategory(tree.categories, categoryId, parentId)) {
        return tree;
    }
    return {
        ...tree,
        categories: tree.categories.map(category => (
            category.id === categoryId ? { ...category, parentId } : category
        )),
    };
}

/**
 * Deletes a category and everything under it.
 *
 * Removal is by subtree rather than by promoting the children: a child of a
 * deleted "游戏开发" has no meaning once its parent is gone, and silently
 * promoting it to a root would leave an orphan label the user did not create.
 * Sessions filed in the removed subtree lose their label and return to the
 * uncategorised list, because the session itself is never touched by this.
 */
export function deleteCategory(
    tree: SessionCategoryTree,
    categoryId: string,
): SessionCategoryTree {
    const removed = new Set([categoryId, ...getDescendantIds(tree.categories, categoryId)]);

    const assignments: Record<string, string> = {};
    for (const [sessionId, assignedId] of Object.entries(tree.assignments)) {
        if (!removed.has(assignedId)) {
            assignments[sessionId] = assignedId;
        }
    }

    return {
        categories: tree.categories.filter(category => !removed.has(category.id)),
        assignments,
    };
}

/** Reorders a category among its siblings. */
export function setCategoryOrder(
    tree: SessionCategoryTree,
    categoryId: string,
    order: number,
): SessionCategoryTree {
    return {
        ...tree,
        categories: tree.categories.map(category => (
            category.id === categoryId ? { ...category, order } : category
        )),
    };
}

/** Files a session under a category, or clears it with `null`. */
export function assignSessionToCategory(
    tree: SessionCategoryTree,
    sessionId: string,
    categoryId: string | null,
): SessionCategoryTree {
    const assignments = { ...tree.assignments };
    if (categoryId === null || !tree.categories.some(category => category.id === categoryId)) {
        delete assignments[sessionId];
    } else {
        assignments[sessionId] = categoryId;
    }
    return { ...tree, assignments };
}

/**
 * Drops assignments for sessions that no longer exist.
 *
 * Bulk delete removes sessions without ever knowing about categories, so this
 * is how a deleted session stops counting toward a category's total. Without
 * it the sidebar would keep advertising sessions nothing can open.
 */
export function pruneSessionAssignments(
    tree: SessionCategoryTree,
    liveSessionIds: ReadonlySet<string>,
): SessionCategoryTree {
    const assignments: Record<string, string> = {};
    let changed = false;
    for (const [sessionId, categoryId] of Object.entries(tree.assignments)) {
        if (liveSessionIds.has(sessionId)) {
            assignments[sessionId] = categoryId;
        } else {
            changed = true;
        }
    }
    return changed ? { ...tree, assignments } : tree;
}

/**
 * Names from the root down to the session's category, for a breadcrumb.
 * Empty when the session has no assignment.
 */
export function getCategoryPath(
    tree: SessionCategoryTree,
    sessionId: string,
): SessionCategory[] {
    const categoryId = tree.assignments[sessionId];
    if (!categoryId) return [];

    const byId = new Map(tree.categories.map(category => [category.id, category]));
    const path: SessionCategory[] = [];
    const seen = new Set<string>();
    let current = byId.get(categoryId);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
}

/**
 * Repairs a stored tree: drops malformed entries, promotes orphans to roots,
 * and breaks cycles.
 *
 * The tree arrives from KV, which means it was written by another device (or
 * an older build) and is not trusted input. Anything unrepairable is dropped
 * rather than thrown, so a single bad record cannot make the sidebar
 * unopenable.
 */
export function sanitizeSessionCategoryTree(tree: SessionCategoryTree): SessionCategoryTree {
    const byId = new Map<string, SessionCategory>();
    for (const category of tree.categories) {
        if (!byId.has(category.id)) {
            byId.set(category.id, category);
        }
    }

    // A category reachable from itself is cut loose to a root; everything it
    // pointed at stays valid.
    for (const category of byId.values()) {
        const seen = new Set<string>([category.id]);
        let parentId = category.parentId;
        while (parentId) {
            if (seen.has(parentId)) {
                category.parentId = null;
                break;
            }
            seen.add(parentId);
            parentId = byId.get(parentId)?.parentId ?? null;
        }
    }

    const clean = [...byId.values()];
    for (const category of clean) {
        if (category.parentId && !byId.has(category.parentId)) {
            category.parentId = null;
        }
        if (getCategoryDepth(clean, category.id) > SESSION_CATEGORY_MAX_DEPTH) {
            category.parentId = null;
        }
    }

    const assignments: Record<string, string> = {};
    for (const [sessionId, categoryId] of Object.entries(tree.assignments)) {
        if (byId.has(categoryId)) {
            assignments[sessionId] = categoryId;
        }
    }

    return { categories: clean, assignments };
}

/** Ids of a category and its descendants, for a "delete subtree" preview. */
export function collectSubtreeIds(
    tree: SessionCategoryTree,
    categoryId: string,
): string[] {
    return [categoryId, ...getDescendantIds(tree.categories, categoryId)];
}

/** The order a newly created sibling should take: after every existing one. */
export function nextSiblingOrder(
    tree: SessionCategoryTree,
    parentId: string | null,
): number {
    const siblings = tree.categories.filter(category => category.parentId === parentId);
    if (siblings.length === 0) {
        return 0;
    }
    return Math.max(...siblings.map(category => category.order)) + 1;
}

/**
 * Builds a category ready to add, with its position among siblings filled in.
 *
 * The id is passed in rather than generated here so this stays pure and
 * testable; the caller owns the source of ids.
 */
export function makeCategory(
    tree: SessionCategoryTree,
    params: { id: string; name: string; parentId: string | null },
): SessionCategory {
    return {
        id: params.id,
        name: params.name,
        parentId: params.parentId,
        order: nextSiblingOrder(tree, params.parentId),
    };
}

export interface CategoryDeletionImpact {
    /** Categories removed, the target included. Zero if it is already gone. */
    categoryCount: number;
    /** Sessions that lose their label and return to the uncategorised list. */
    affectedSessionCount: number;
}

/**
 * What deleting a category would destroy, for the confirmation the user reads
 * before it happens. The session count is the number the dialog needs and the
 * one the tree cannot show on its own: categories hold no sessions, they only
 * label them.
 */
export function describeCategoryDeletion(
    tree: SessionCategoryTree,
    categoryId: string,
): CategoryDeletionImpact {
    if (!tree.categories.some(category => category.id === categoryId)) {
        return { categoryCount: 0, affectedSessionCount: 0 };
    }

    const removed = new Set(collectSubtreeIds(tree, categoryId));
    let affectedSessionCount = 0;
    for (const assignedId of Object.values(tree.assignments)) {
        if (removed.has(assignedId)) {
            affectedSessionCount += 1;
        }
    }

    return { categoryCount: removed.size, affectedSessionCount };
}

/**
 * Moves a session to a category, or clears it.
 *
 * A thin alias of `assignSessionToCategory`, kept because the UI's "move to
 * category" action and the data layer's "set assignment" should read as the
 * same operation — the one-category-per-session rule lives in that function.
 */
export function reassignSession(
    tree: SessionCategoryTree,
    sessionId: string,
    categoryId: string | null,
): SessionCategoryTree {
    return assignSessionToCategory(tree, sessionId, categoryId);
}

export { EMPTY_SESSION_CATEGORY_TREE };
