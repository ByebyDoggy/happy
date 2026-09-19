import type { BulkDeleteOutcome } from '@/sync/bulkSessionDelete';

/**
 * Turns a finished bulk delete into the one line the user is shown.
 *
 * The confirmation before the delete is written from the *planned* counts, and
 * this from the *actual* ones, so a session that vanished mid-run or a request
 * that failed is reported rather than silently folded into a success message.
 */

export interface BulkDeleteReport {
    /** Rows the server confirmed deleted. */
    deletedCount: number;
    /** Rows the server refused, or whose request threw. */
    failedCount: number;
    /** Bots dropped before any request was made. */
    skippedBotCount: number;
    /**
     * True when anything was refused. The caller picks the error styling from
     * this rather than from `failedCount` so the reason stays in one place.
     */
    hasFailures: boolean;
}

export function buildBulkDeleteReport(outcome: BulkDeleteOutcome): BulkDeleteReport {
    return {
        deletedCount: outcome.deleted.length,
        failedCount: outcome.failed.length,
        skippedBotCount: outcome.skippedBots.length,
        hasFailures: outcome.failed.length > 0,
    };
}

/**
 * The first failed row's message, for the detail line under the summary.
 *
 * Only the first is shown: `Modal.alert` renders a fixed-size box, and a list
 * of twenty identical transport errors would bury the count that matters.
 */
export function firstFailureMessage(outcome: BulkDeleteOutcome): string | null {
    return outcome.failed[0]?.message ?? null;
}

/**
 * Whether the delete left anything behind. Drives whether the caller reports
 * at all — a clean run of a selection the user already confirmed needs no
 * second dialog.
 */
export function needsBulkDeleteReport(outcome: BulkDeleteOutcome): boolean {
    return outcome.failed.length > 0 || outcome.skippedBots.length > 0;
}
