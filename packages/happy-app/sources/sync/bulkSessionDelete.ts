/**
 * Bulk deletion for the archive's selection mode.
 *
 * The server deletes one session per request (`DELETE /v1/sessions/:id`) and
 * there is no batch endpoint, so a selection of N rows is N transactions and N
 * socket broadcasts. Firing all of them at once would put N simultaneous
 * transactions on the server and N broadcasts through `activityCache`, so the
 * work is drained by a small pool instead.
 *
 * The pool is a plain worker loop rather than `Promise.all` for a second
 * reason: one refused session must not abandon the rest of the selection.
 * Every target is attempted and the caller gets a per-row verdict back.
 */

/**
 * Requests in flight at once. Four keeps the round trips overlapped without
 * stacking transactions on a self-hosted server.
 */
export const BULK_DELETE_CONCURRENCY = 4;

/** One row the user picked in the archive's selection mode. */
export interface BulkDeleteTarget {
    id: string;
    /** A bot keeps one continuous conversation; the server refuses to delete it. */
    isBot: boolean;
}

export interface BulkDeleteOutcome {
    /** Ids the server confirmed deleted. */
    deleted: string[];
    /** Rows the server refused, or the request for which threw. */
    failed: { id: string; message: string }[];
    /** Bots dropped before any request was made. */
    skippedBots: string[];
}

export interface BulkDeletePartition {
    deletable: BulkDeleteTarget[];
    skippedBots: string[];
}

/**
 * Splits bots out of the selection. They are filtered before the first request
 * rather than attempted and refused: `sessionDelete` already rejects them
 * client-side, so attempting one would only add a guaranteed failure to the
 * result the user is shown.
 */
export function partitionBulkDeleteTargets(
    targets: readonly BulkDeleteTarget[],
): BulkDeletePartition {
    const deletable: BulkDeleteTarget[] = [];
    const skippedBots: string[] = [];

    for (const target of targets) {
        if (target.isBot) {
            skippedBots.push(target.id);
        } else {
            deletable.push(target);
        }
    }

    return { deletable, skippedBots };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Deletes every non-bot target, at most `concurrency` at a time, and reports
 * what happened to each. Never rejects: a throwing `deleteOne` is recorded as
 * that row's failure and the remaining rows still run.
 */
export async function runBulkSessionDelete(
    targets: readonly BulkDeleteTarget[],
    deleteOne: (id: string) => Promise<{ success: boolean; message?: string }>,
    concurrency: number = BULK_DELETE_CONCURRENCY,
): Promise<BulkDeleteOutcome> {
    const { deletable, skippedBots } = partitionBulkDeleteTargets(targets);
    const deleted: string[] = [];
    const failed: { id: string; message: string }[] = [];

    // `cursor` is advanced synchronously before the first await in each worker,
    // so no two workers can claim the same index.
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, deletable.length));

    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = cursor++;
            if (index >= deletable.length) {
                return;
            }

            const target = deletable[index];
            try {
                const result = await deleteOne(target.id);
                if (result.success) {
                    deleted.push(target.id);
                } else {
                    failed.push({
                        id: target.id,
                        message: result.message || 'Failed to delete session',
                    });
                }
            } catch (error) {
                failed.push({ id: target.id, message: errorMessage(error) });
            }
        }
    });

    await Promise.all(workers);

    return { deleted, failed, skippedBots };
}
