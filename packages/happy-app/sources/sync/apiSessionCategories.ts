import { kvGet, kvMutate, kvSet, type KvItem } from './apiKv';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
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
 * Values on the wire are **base64**, because the store's column is a byte
 * array: the server decodes the string it receives and re-encodes it on the
 * way out. That is not optional — sending raw JSON means the server either
 * rejects the write outright (`Base64Coder: incorrect characters`, on the
 * update path) or, worse, silently stores six bytes of mangled data (on the
 * create path, where `Buffer.from(x, 'base64')` skips the illegal characters
 * instead of complaining). The encode/decode pair below is the whole of the
 * client's obligation; `apiKv` stays a plain transport.
 *
 * Nothing the server does here is category-aware. It stores opaque bytes
 * under a key it cannot read.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface LoadedSessionCategories {
    tree: SessionCategoryTree;
    /** KV version, for the next optimistic write. -1 when the record is new. */
    version: number;
}

/**
 * The tree as stored, or null when the record is absent.
 *
 * A record that fails to decode returns `corrupt` rather than null. The two
 * cases look alike — both leave this device with no tree — but they need
 * different handling: an absent record should be created, while a corrupt one
 * already exists and must be overwritten *at its current version*, since
 * creating it would just lose the version race and leave the account stuck.
 */
export async function loadSessionCategories(
    credentials: AuthCredentials,
): Promise<LoadedSessionCategories | { corrupt: true; version: number } | null> {
    const item = await kvGet(credentials, SESSION_CATEGORIES_KV_KEY);
    if (!item) {
        return null;
    }
    return decodeSessionCategories(item);
}

export function decodeSessionCategories(
    item: KvItem,
): LoadedSessionCategories | { corrupt: true; version: number } {
    const decoded = decodeStoredTree(item.value);
    if (!decoded) {
        return { corrupt: true, version: item.version };
    }
    return { tree: decoded, version: item.version };
}

/** The tree inside a stored value, or null if the value is unusable. */
function decodeStoredTree(value: string): SessionCategoryTree | null {
    let text: string;
    try {
        text = decoder.decode(decodeBase64(value, 'base64'));
    } catch {
        // Not base64 at all. Records written by a build that skipped the
        // encoding step land here.
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
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

    return sanitizeSessionCategoryTree(tree.data);
}

export function isCorruptRecord(
    loaded: LoadedSessionCategories | { corrupt: true; version: number },
): loaded is { corrupt: true; version: number } {
    return 'corrupt' in loaded;
}

/** Serialises a tree into the versioned envelope written to KV, as base64. */
export function encodeSessionCategories(tree: SessionCategoryTree): string {
    const json = JSON.stringify({ version: SESSION_CATEGORY_TREE_VERSION, tree });
    return encodeBase64(encoder.encode(json), 'base64');
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
            current: await readCurrentSafely(credentials),
        };
    }

    return { ok: true, version: result.results[0].version };
}

/** The stored tree if it is readable, null if it is absent or corrupt. */
async function readCurrentSafely(
    credentials: AuthCredentials,
): Promise<LoadedSessionCategories | null> {
    const loaded = await loadSessionCategories(credentials).catch(() => null);
    if (!loaded || isCorruptRecord(loaded)) {
        return null;
    }
    return loaded;
}

/**
 * Returns the stored tree, creating it when the account has none.
 *
 * A corrupt record is overwritten rather than left alone. It already exists at
 * a known version, so creating a fresh one would lose the version race and
 * leave the account permanently unreadable — which is exactly the state a
 * build that skipped the base64 step above leaves behind. Overwriting at the
 * stored version is the only repair that does not need the user to intervene.
 */
export async function ensureSessionCategories(
    credentials: AuthCredentials,
): Promise<LoadedSessionCategories> {
    const loaded = await loadSessionCategories(credentials);

    if (loaded && !isCorruptRecord(loaded)) {
        return loaded;
    }

    if (loaded) {
        // Present but unreadable: replace it where it stands.
        const saved = await saveSessionCategories(
            credentials,
            EMPTY_SESSION_CATEGORY_TREE,
            loaded.version,
        );
        return {
            tree: EMPTY_SESSION_CATEGORY_TREE,
            version: saved.ok ? saved.version : loaded.version,
        };
    }

    // Absent: create it, so this device has a version to write against instead
    // of special-casing -1 everywhere downstream.
    const version = await kvSet(
        credentials,
        SESSION_CATEGORIES_KV_KEY,
        encodeSessionCategories(EMPTY_SESSION_CATEGORY_TREE),
        -1,
    );
    return { tree: EMPTY_SESSION_CATEGORY_TREE, version };
}
