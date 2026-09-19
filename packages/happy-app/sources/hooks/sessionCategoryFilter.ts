import type { SessionListViewItem } from '@/sync/storage';
import type { SessionCategoryTree } from '@/sync/sessionCategories';
import { getDescendantIds } from '@/sync/sessionCategoryOps';

/**
 * Filtering the session list down to one category.
 *
 * Selecting a category means "everything filed under it", which includes its
 * sub-categories: a root named "游戏开发" holds work filed directly under it and
 * work filed under its "2D" child alike. Filtering to the root but hiding its
 * children would make the tree structure a trap.
 *
 * The filter is resolved to a set of session ids once and then applied, rather
 * than testing every row against the tree: the tree walk happens once instead
 * of per row, and the row pass keeps the shape of the existing archive filter.
 */

/** The pseudo-category standing for sessions filed under nothing. */
export const UNCATEGORISED_FILTER = '__uncategorised__';

export type SessionCategoryFilter = string | null;

/**
 * The session ids a filter admits, or `null` for "no filter".
 *
 * The uncategorised sentinel is handled by the caller rather than here: it
 * admits the *complement* of the assigned set, and returning a set that means
 * the opposite of every other set would be a trap.
 */
export function collectAssignedSessionIds(
    tree: SessionCategoryTree,
    categoryId: string,
): Set<string> {
    const allowed = new Set<string>([categoryId, ...getDescendantIds(tree.categories, categoryId)]);
    const sessionIds = new Set<string>();
    for (const [sessionId, assignedId] of Object.entries(tree.assignments)) {
        if (allowed.has(assignedId)) {
            sessionIds.add(sessionId);
        }
    }
    return sessionIds;
}

/** Whether a category id is one the tree still knows about. */
export function isKnownCategory(tree: SessionCategoryTree, categoryId: string): boolean {
    if (categoryId === UNCATEGORISED_FILTER) return true;
    return tree.categories.some(category => category.id === categoryId);
}

/**
 * Applies a category filter to the list the sidebar renders.
 *
 * Mirrors `useVisibleSessionListViewData`: project cards are filtered through
 * their workspaces, a workspace or project left empty disappears, and a date
 * heading is held back until a row under it survives. A heading with nothing
 * beneath it reads as a bug.
 *
 * A filter naming a category that is gone admits nothing rather than
 * everything: silently showing the whole list would look like the filter had
 * been dropped, when what actually happened is that the category was deleted on
 * another device.
 */
export function filterSessionListByCategory(
    items: readonly SessionListViewItem[],
    tree: SessionCategoryTree,
    filter: SessionCategoryFilter,
): SessionListViewItem[] {
    if (filter === null) {
        return items as SessionListViewItem[];
    }

    const uncategorised = filter === UNCATEGORISED_FILTER;
    const assigned = uncategorised
        ? null
        : collectAssignedSessionIds(tree, filter);

    if (!uncategorised && !isKnownCategory(tree, filter)) {
        return [];
    }

    const admits = (sessionId: string): boolean => {
        const isAssigned = tree.assignments[sessionId] !== undefined;
        return uncategorised ? !isAssigned : assigned!.has(sessionId);
    };

    const result: SessionListViewItem[] = [];
    let pendingHeader: SessionListViewItem | null = null;

    for (const item of items) {
        switch (item.type) {
            case 'project': {
                const workspaces = item.project.workspaces
                    .map(workspace => ({
                        ...workspace,
                        sessions: workspace.sessions.filter(session => admits(session.id)),
                    }))
                    .filter(workspace => workspace.sessions.length > 0);
                if (workspaces.length === 0) break;

                const sessions = workspaces.flatMap(workspace => workspace.sessions);
                result.push({
                    ...item,
                    project: {
                        ...item.project,
                        workspaces,
                        sessionCount: sessions.length,
                        activeCount: sessions.filter(session => session.active).length,
                    },
                });
                break;
            }

            // Grouping label for the cards below it; the cards themselves are
            // either kept above or dropped whole, so the label goes with them.
            case 'projects-header':
                break;

            case 'bots':
            case 'active-sessions': {
                const sessions = item.sessions.filter(session => admits(session.id));
                if (sessions.length > 0) {
                    result.push({ ...item, sessions });
                }
                break;
            }

            case 'header':
                pendingHeader = item;
                break;

            case 'session':
                if (!admits(item.session.id)) break;
                if (pendingHeader) {
                    result.push(pendingHeader);
                    pendingHeader = null;
                }
                result.push(item);
                break;

            case 'project-group':
                result.push(item);
                break;
        }
    }

    return result;
}

/**
 * How many sessions are filed under a category or below it. Drives whether a
 * chip is shown: a chip that filters to a blank list is worse than no chip.
 */
export function countSessionsInCategory(
    tree: SessionCategoryTree,
    categoryId: string,
): number {
    return collectAssignedSessionIds(tree, categoryId).size;
}
