import * as React from 'react';
import { Modal } from '@/modal';
import { storage } from '@/sync/storage';
import { sessionDelete, sessionKill } from '@/sync/ops';
import { runBulkSessionDelete, type BulkDeleteOutcome, type BulkDeleteTarget } from '@/sync/bulkSessionDelete';
import { buildBulkDeleteReport, firstFailureMessage, needsBulkDeleteReport } from '@/sync/bulkDeleteReport';
import {
    EMPTY_ARCHIVE_SELECTION,
    clearArchiveSelection,
    isEveryTargetSelected,
    resolveSelectedTargets,
    setArchiveSelectionFor,
    toggleArchiveSelection,
    type ArchiveSelectionState,
} from '@/hooks/archiveSelection';
import { t } from '@/text';

/**
 * Selection mode and the bulk delete behind the archive's toggle row.
 *
 * The delete itself is the same three steps the single-session flow uses —
 * stop the agent, then remove the session — with one deliberate difference:
 * worktree cleanup is skipped. `maybeCleanupWorktree` asks the user a question
 * per session, and a selection of twenty would be twenty dialogs. The archived
 * sessions keep their checkouts on disk instead, which is the recoverable
 * direction to fail in.
 *
 * Progress is reported through React state rather than `useHappyAction`,
 * because that hook answers every failure with a generic "Error" dialog. Here
 * the outcome is a count, and a partial failure is worth reading.
 */
export function useArchiveBulkDelete(targets: readonly BulkDeleteTarget[]) {
    const [selection, setSelection] = React.useState<ArchiveSelectionState>(EMPTY_ARCHIVE_SELECTION);
    const [deleting, setDeleting] = React.useState(false);

    const selectedTargets = React.useMemo(
        () => resolveSelectedTargets(targets, selection.selectedIds),
        [selection.selectedIds, targets],
    );
    const allSelected = React.useMemo(
        () => isEveryTargetSelected(targets, selection.selectedIds),
        [selection.selectedIds, targets],
    );

    const startSelecting = React.useCallback(() => {
        setSelection({ selecting: true, selectedIds: new Set<string>() });
    }, []);

    const cancelSelecting = React.useCallback(() => {
        setSelection(clearArchiveSelection());
    }, []);

    const toggle = React.useCallback((id: string) => {
        setSelection((current) => toggleArchiveSelection(current, id));
    }, []);

    const toggleAll = React.useCallback(() => {
        setSelection((current) => setArchiveSelectionFor(
            current,
            targets.map(target => target.id),
            !isEveryTargetSelected(targets, current.selectedIds),
        ));
    }, [targets]);

    const performDelete = React.useCallback(async (chosen: readonly BulkDeleteTarget[]) => {
        setDeleting(true);
        try {
            const outcome = await runBulkSessionDelete(chosen, async (id) => {
                // An archived session should already be stopped, but a Rig
                // session can carry `lifecycleState: 'archived'` while its
                // process is still up. Killing is best-effort: a failure here
                // means the agent is already gone, and the delete must still
                // be attempted.
                if (storage.getState().sessions[id]?.active) {
                    await sessionKill(id).catch(() => {});
                }
                return sessionDelete(id);
            });

            setSelection(clearArchiveSelection());
            if (needsBulkDeleteReport(outcome)) {
                showOutcome(outcome);
            }
        } finally {
            setDeleting(false);
        }
    }, []);

    /**
     * The confirmation reads the counts from the live selection, then hands
     * the frozen list to `performDelete` so the dialog the user approves is the
     * one that runs even if the list syncs underneath it.
     */
    const requestDelete = React.useCallback(async () => {
        const chosen = selectedTargets;
        if (chosen.length === 0 || deleting) {
            return;
        }

        const bots = chosen.filter(target => target.isBot).length;
        const deletable = chosen.length - bots;
        if (deletable === 0) {
            Modal.alert(
                t('sidebar.deleteArchivedTitle'),
                t('sidebar.deleteArchivedAllBots', { count: bots }),
            );
            return;
        }

        const lines = [t('sidebar.deleteArchivedMessage', { count: deletable })];
        if (bots > 0) {
            lines.push(t('sidebar.deleteArchivedBotsKept', { count: bots }));
        }

        const confirmed = await Modal.confirm(
            t('sidebar.deleteArchivedTitle'),
            lines.join('\n\n'),
            {
                confirmText: t('sidebar.deleteSelected', { count: deletable }),
                cancelText: t('common.cancel'),
                destructive: true,
            },
        );
        if (!confirmed) {
            return;
        }

        await performDelete(chosen);
    }, [deleting, performDelete, selectedTargets]);

    return {
        selecting: selection.selecting,
        selectedIds: selection.selectedIds,
        selectedCount: selectedTargets.length,
        allSelected,
        deleting,
        /** Drives whether the archive toggle shows the select control at all. */
        canSelect: targets.length > 0,
        startSelecting,
        cancelSelecting,
        toggle,
        toggleAll,
        requestDelete,
    };
}

/**
 * Reports what the delete actually did. A row the server refused, or a bot
 * that was left alone, is the reason this dialog exists — a clean run of a
 * selection the user already approved is not reported.
 */
function showOutcome(outcome: BulkDeleteOutcome): void {
    const report = buildBulkDeleteReport(outcome);
    const detail = firstFailureMessage(outcome);

    if (report.failedCount > 0) {
        Modal.alert(
            t('sidebar.deleteArchivedPartialTitle'),
            [
                t('sidebar.deleteArchivedPartialMessage', {
                    deleted: report.deletedCount,
                    failed: report.failedCount,
                }),
                detail,
            ].filter(Boolean).join('\n\n'),
        );
        return;
    }

    Modal.alert(
        t('sidebar.deleteArchivedTitle'),
        t('sidebar.deleteArchivedBotsKept', { count: report.skippedBotCount }),
    );
}
