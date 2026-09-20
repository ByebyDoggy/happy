import type { SessionCategoryTree } from './sessionCategories';

/**
 * A single-record read-modify-write against the account KV store.
 *
 * Extracted from the sync engine so the retry can be tested without standing
 * up a socket, a store, and an encryption session. The sync engine supplies
 * the parts that touch the world; everything about ordering, retrying, and
 * giving up lives here.
 */

export interface CategoryWriteIo {
    /** The tree this device currently believes the account holds. */
    readLocal(): SessionCategoryTree;
    /** KV version the local tree was read at, or -1 if never read. */
    readVersion(): number;
    /** Whether the record has been read at least once. */
    isLoaded(): boolean;
    /**
     * Writes `tree` at `version`. On a version mismatch the server's current
     * record comes back so the caller can retry against it.
     */
    write(
        tree: SessionCategoryTree,
        version: number,
    ): Promise<
        | { ok: true; version: number }
        | { ok: false; current: { tree: SessionCategoryTree; version: number } | null }
    >;
    /** Publishes a tree to the store, and records the version it was read at. */
    publish(tree: SessionCategoryTree, version: number): void;
}

export type CategoryWriteResult =
    | { ok: true }
    | { ok: false; reason: 'not-loaded' }
    | { ok: false; reason: 'version-mismatch' };

/**
 * Attempts before an edit is reported as conflicting.
 *
 * Three is enough to absorb this device's own broadcast echo, which is the
 * usual cause. The server emits `kv-batch-update` to every connection on the
 * account *including the one that wrote*, so a second edit made before this
 * device has re-read its own write would otherwise race that echo and fail
 * with a message about a device that does not exist.
 *
 * Beyond three rounds the write is losing to something that keeps writing — a
 * real concurrent editor — and the user is told rather than waiting silently.
 */
export const CATEGORY_WRITE_ATTEMPTS = 3;

/**
 * Runs `transform` against the current tree and writes the result, retrying
 * against the server's version when it loses a race.
 *
 * The transform is replayable because it is a pure function of the tree it is
 * given, which is what makes retrying safe: each attempt is recomputed from
 * whatever the account actually holds, not from this device's stale copy.
 */
export async function writeSessionCategories(
    io: CategoryWriteIo,
    transform: (tree: SessionCategoryTree) => SessionCategoryTree,
): Promise<CategoryWriteResult> {
    if (!io.isLoaded()) {
        // Writing now would be a read-modify-write against a tree this device
        // has never seen, discarding whatever the account holds.
        return { ok: false, reason: 'not-loaded' };
    }

    for (let attempt = 0; attempt < CATEGORY_WRITE_ATTEMPTS; attempt++) {
        const next = transform(io.readLocal());
        const result = await io.write(next, io.readVersion());

        if (result.ok) {
            io.publish(next, result.version);
            return { ok: true };
        }

        if (!result.current) {
            // The re-read failed too, so there is no version to retry with.
            return { ok: false, reason: 'version-mismatch' };
        }

        // Adopt what the server holds before the next attempt, so the replay
        // builds on it rather than on this device's stale copy.
        io.publish(result.current.tree, result.current.version);
    }

    return { ok: false, reason: 'version-mismatch' };
}
