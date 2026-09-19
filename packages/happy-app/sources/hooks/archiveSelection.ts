import type { SessionListViewItem } from '@/sync/storage';
import type { BulkDeleteTarget } from '@/sync/bulkSessionDelete';

/**
 * Selection state for the archive's bulk-delete mode.
 *
 * Selection is deliberately a set of ids rather than a flag on each row: rows
 * are rebuilt from the store on every sync tick, so anything stored on a row
 * would be lost mid-selection. Ids also survive the archive list re-sorting
 * under the user while the selection is open.
 *
 * Every function here is pure and returns a new set, so the caller can hold it
 * in React state without the identity of the old set leaking into the new one.
 */

/** What the archive-toggle row shows, and what bulk delete will act on. */
export interface ArchiveSelectionState {
    selecting: boolean;
    selectedIds: ReadonlySet<string>;
}

export const EMPTY_ARCHIVE_SELECTION: ArchiveSelectionState = {
    selecting: false,
    selectedIds: new Set<string>(),
};

export function toggleArchiveSelection(
    state: ArchiveSelectionState,
    id: string,
): ArchiveSelectionState {
    const selectedIds = new Set(state.selectedIds);
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    return { selecting: state.selecting, selectedIds };
}

/** Leaves selection mode and drops the ids with it. */
export function clearArchiveSelection(): ArchiveSelectionState {
    return { selecting: false, selectedIds: new Set<string>() };
}

/**
 * Adds or removes every id in `ids` at once. Used by the "select all" control,
 * which passes the whole archive; a second press clears instead.
 */
export function setArchiveSelectionFor(
    state: ArchiveSelectionState,
    ids: readonly string[],
    selected: boolean,
): ArchiveSelectionState {
    const selectedIds = new Set(state.selectedIds);
    for (const id of ids) {
        if (selected) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
    }
    return { selecting: state.selecting, selectedIds };
}

/**
 * The archived sessions a bulk delete may act on, in list order.
 *
 * Only the flat tail counts: project cards never hold archived sessions
 * (`buildSessionListViewData` routes every archived session into the tail), so
 * scanning them here would be dead work. Date headings are skipped for the
 * same reason — they carry no session.
 */
export function collectArchivedTargets(
    items: readonly SessionListViewItem[],
): BulkDeleteTarget[] {
    const targets: BulkDeleteTarget[] = [];

    for (const item of items) {
        if (item.type !== 'session') {
            continue;
        }
        if (!item.session.archived) {
            continue;
        }
        targets.push({
            id: item.session.id,
            isBot: !!item.session.botId,
        });
    }

    return targets;
}

/** Ids of the archived rows offered for selection. */
export function collectArchivedIds(
    items: readonly SessionListViewItem[],
): string[] {
    return collectArchivedTargets(items).map(target => target.id);
}

/**
 * Keeps only ids that are still archived and still present. Called before a
 * delete so a session that synced away since it was ticked cannot be counted
 * in the confirmation the user is about to approve.
 */
export function resolveSelectedTargets(
    targets: readonly BulkDeleteTarget[],
    selectedIds: ReadonlySet<string>,
): BulkDeleteTarget[] {
    return targets.filter(target => selectedIds.has(target.id));
}

/**
 * Whether every offered row is already ticked, which is what flips the
 * "select all" control into "deselect all".
 */
export function isEveryTargetSelected(
    targets: readonly BulkDeleteTarget[],
    selectedIds: ReadonlySet<string>,
): boolean {
    if (targets.length === 0) {
        return false;
    }
    return targets.every(target => selectedIds.has(target.id));
}
