import { kvGet, kvMutate, kvSet, type KvItem } from './apiKv';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    EMPTY_SESSION_CATEGORY_TREE,
    SESSION_CATEGORIES_KV_KEY,
    SESSION_CATEGORY_TREE_VERSION,
    SessionCategoryTreeSchema,
    StoredSessionCategoryTreeSchema,
    type SessionCategoryTree,
} from './sessionCategories';
import { sanitizeSessionCategoryTree } from './sessionCategoryOps';

/**
 * The category tree's storage, on top of the account KV store.
 *
 * The whole tree is one KV record, which makes every edit a read-modify-write
 * against a single version number. That is deliberate: the KV store's only
 * concurrency control is per-key optimistic locking, so a single record means
 * two devices editing categories at the same moment get a clean conflict on
 * one version rather than a partial merge of two trees that disagree about a
 * parent pointer.
 *
 * Nothing here talks to the server about categories. The server stores an
 * opaque string under a key it cannot read.
 */

export interface LoadedSessionCategories {
    tree: SessionCategoryTree;
    /** KV version, for the next optimistic write. -1 when the record is new. */
    version: number;
}

/**
 * The tree as stored, or null when the record is absent.
 *
 * A record that fails to parse is treated as absent rather than thrown: it
 * could have been written by a newer build, and losing a device's own view of
 * its categories is worse than starting from empty on that device. The caller
 * decides whether to overwrite it.
 */
export async function loadSessionCategories(
    credentials: AuthCredentials,
): Promise<LoadedSessionCategories | null> {
    const item = await kvGet(credentials, SESSION_CATEGORIES_KV_KEY);
    if (!item) {
        return null;
    }
    return decodeSessionCategories(item);
}

export function decodeSessionCategories(item: KvItem): LoadedSessionCategories | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(item.value);
    } catch {
        return null;
    }

    const envelope = StoredSessionCategoryTreeSchema.safeParse(parsed);
    if (!envelope.success) {
        return null;
    }

    const tree = SessionCategoryTreeSchema.safeParse(envelope.data.tree);
    if (!tree.success) {
        return null;
    }

    return {
        tree: sanitizeSessionCategoryTree(tree.data),
        version: item.version,
    };
}

/** Serialises a tree into the versioned envelope written to KV. */
export function encodeSessionCategories(tree: SessionCategoryTree): string {
    return JSON.stringify({ version: SESSION_CATEGORY_TREE_VERSION, tree });
}

export type SaveSessionCategoriesResult =
    | { ok: true; version: number }
    | { ok: false; reason: 'version-mismatch'; current: LoadedSessionCategories | null };

/**
 * Writes the tree at the version it was read at.
 *
 * A version mismatch is returned rather than retried. The caller has to decide
 * what to do with the other device's edit — blindly re-reading and re-applying
 * would silently discard it, and the user is the only one who knows whether
 * their change or the other device's should win.
 */
export async function saveSessionCategories(
    credentials: AuthCredentials,
    tree: SessionCategoryTree,
    version: number,
): Promise<SaveSessionCategoriesResult> {
    const result = await kvMutate(credentials, [{
        key: SESSION_CATEGORIES_KV_KEY,
        value: encodeSessionCategories(tree),
        version,
    }]);

    if (result.success === false) {
        // Re-read so the caller can show what the other device wrote.
        return {
            ok: false,
            reason: 'version-mismatch',
            current: await loadSessionCategories(credentials).catch(() => null),
        };
    }

    return { ok: true, version: result.results[0].version };
}

/**
 * Creates the record if it is missing. Used on first load so a fresh account
 * has a version to write against instead of having to special-case -1
 * everywhere downstream.
 */
export async function ensureSessionCategories(
    credentials: AuthCredentials,
): Promise<LoadedSessionCategories> {
    const existing = await loadSessionCategories(credentials);
    if (existing) {
        return existing;
    }

    const version = await kvSet(
        credentials,
        SESSION_CATEGORIES_KV_KEY,
        encodeSessionCategories(EMPTY_SESSION_CATEGORY_TREE),
        -1,
    );
    return { tree: EMPTY_SESSION_CATEGORY_TREE, version };
}
