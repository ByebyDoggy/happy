import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    kvGet: vi.fn(),
    kvMutate: vi.fn(),
    kvSet: vi.fn(),
}));

vi.mock('./apiKv', () => ({
    kvGet: mocks.kvGet,
    kvMutate: mocks.kvMutate,
    kvSet: mocks.kvSet,
}));

import {
    decodeSessionCategories,
    encodeSessionCategories,
    ensureSessionCategories,
    isCorruptRecord,
    loadSessionCategories,
    saveSessionCategories,
} from './apiSessionCategories';
import { SESSION_CATEGORIES_KV_KEY } from './sessionCategories';
import type { SessionCategoryTree } from './sessionCategories';

/**
 * A stand-in for the server's byte column.
 *
 * The real store holds a *byte array*: it base64-decodes what the client sends
 * and base64-encodes what it returns. Modelling that is the whole point of
 * these tests — the bug they exist for was a client that skipped the encoding
 * step, which the server accepted on one path and rejected on the other.
 */
function serverColumn() {
    let bytes: Uint8Array | null = null;
    let version = -1;

    return {
        /** What happens to a client value on the way in. */
        write(value: string, expectedVersion: number) {
            if (expectedVersion !== version) {
                return { ok: false as const, currentVersion: version, currentBytes: bytes };
            }
            if (expectedVersion === -1) {
                // Create path: Buffer.from skips illegal characters silently.
                bytes = new Uint8Array(Buffer.from(value, 'base64'));
            } else {
                // Update path: privacy-kit throws on illegal characters.
                if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
                    throw new Error('Base64Coder: incorrect characters for decoding');
                }
                bytes = new Uint8Array(Buffer.from(value, 'base64'));
            }
            version += 1;
            return { ok: true as const, version };
        },
        /** What a read hands back. */
        read() {
            if (bytes === null) return null;
            return {
                key: SESSION_CATEGORIES_KV_KEY,
                value: Buffer.from(bytes).toString('base64'),
                version,
            };
        },
        /** Pre-seed a raw record, for the corrupt cases. */
        seed(rawBytes: Uint8Array, atVersion: number) {
            bytes = rawBytes;
            version = atVersion;
        },
        getVersion: () => version,
    };
}

const tree: SessionCategoryTree = {
    categories: [{ id: 'game', name: '游戏开发', parentId: null, order: 0 }],
    assignments: { s1: 'game' },
};

beforeEach(() => {
    mocks.kvGet.mockReset();
    mocks.kvMutate.mockReset();
    mocks.kvSet.mockReset();
});

describe('round trip through the server column', () => {
    it('survives a create, which is where a missing encode passes unnoticed', () => {
        const column = serverColumn();

        const written = column.write(encodeSessionCategories(tree), -1);
        expect(written.ok).toBe(true);

        const item = column.read()!;
        const decoded = decodeSessionCategories(item);

        expect(isCorruptRecord(decoded)).toBe(false);
        expect(decoded).toEqual({ tree, version: 0 });
    });

    it('survives an update, which is where a missing encode throws', () => {
        const column = serverColumn();
        column.write(encodeSessionCategories(tree), -1);

        // The update path is the one that rejects rather than mangles.
        expect(() => column.write(encodeSessionCategories(tree), 0)).not.toThrow();

        const decoded = decodeSessionCategories(column.read()!);
        expect(decoded).toEqual({ tree, version: 1 });
    });

    it('would not survive a payload that skipped the encoding step', () => {
        // Guards the tests themselves: if the server column stopped caring
        // about base64, the two tests above would pass for the wrong reason.
        const column = serverColumn();
        // Get the record to version 0 first, or the write short-circuits on the
        // version check and never reaches the decode.
        column.write(encodeSessionCategories(tree), -1);
        const rawJson = JSON.stringify({ version: 1, tree });

        expect(() => column.write(rawJson, 0)).toThrow(/Base64Coder/);

        // ...and on the create path it is accepted, storing mangled bytes.
        const created = serverColumn();
        expect(created.write(rawJson, -1).ok).toBe(true);
        expect(isCorruptRecord(decodeSessionCategories(created.read()!))).toBe(true);
    });

    it('keeps non-ASCII names intact', () => {
        const column = serverColumn();
        const unicode: SessionCategoryTree = {
            categories: [{ id: 'a', name: 'ゲーム開発 🎮', parentId: null, order: 0 }],
            assignments: {},
        };

        column.write(encodeSessionCategories(unicode), -1);

        expect(decodeSessionCategories(column.read()!)).toEqual({ tree: unicode, version: 0 });
    });
});

describe('decodeSessionCategories', () => {
    it('reports a corrupt record with its version rather than null', () => {
        const item = { key: SESSION_CATEGORIES_KV_KEY, value: 'not-base64!!', version: 7 };

        const decoded = decodeSessionCategories(item);

        expect(isCorruptRecord(decoded)).toBe(true);
        expect(decoded).toEqual({ corrupt: true, version: 7 });
    });

    it('reports a valid base64 payload holding non-JSON', () => {
        const item = {
            key: SESSION_CATEGORIES_KV_KEY,
            value: Buffer.from('hello there').toString('base64'),
            version: 3,
        };

        expect(isCorruptRecord(decodeSessionCategories(item))).toBe(true);
    });

    it('reports JSON that does not match the envelope', () => {
        const item = {
            key: SESSION_CATEGORIES_KV_KEY,
            value: Buffer.from(JSON.stringify({ nope: true })).toString('base64'),
            version: 3,
        };

        expect(isCorruptRecord(decodeSessionCategories(item))).toBe(true);
    });

    it('reports the envelope with a malformed tree inside it', () => {
        const item = {
            key: SESSION_CATEGORIES_KV_KEY,
            value: Buffer.from(JSON.stringify({
                version: 1,
                tree: { categories: 'not an array', assignments: {} },
            })).toString('base64'),
            version: 3,
        };

        expect(isCorruptRecord(decodeSessionCategories(item))).toBe(true);
    });
});

describe('loadSessionCategories', () => {
    it('returns null when the key is absent', async () => {
        mocks.kvGet.mockResolvedValue(null);

        expect(await loadSessionCategories({} as never)).toBeNull();
    });

    it('returns the tree when the record is readable', async () => {
        mocks.kvGet.mockResolvedValue({
            key: SESSION_CATEGORIES_KV_KEY,
            value: encodeSessionCategories(tree),
            version: 4,
        });

        expect(await loadSessionCategories({} as never)).toEqual({ tree, version: 4 });
    });

    it('returns the corrupt marker when it is not', async () => {
        mocks.kvGet.mockResolvedValue({ key: SESSION_CATEGORIES_KV_KEY, value: '!!', version: 4 });

        const loaded = await loadSessionCategories({} as never);

        expect(loaded && isCorruptRecord(loaded)).toBe(true);
    });
});

describe('ensureSessionCategories', () => {
    it('returns an existing record without writing', async () => {
        mocks.kvGet.mockResolvedValue({
            key: SESSION_CATEGORIES_KV_KEY,
            value: encodeSessionCategories(tree),
            version: 4,
        });

        expect(await ensureSessionCategories({} as never)).toEqual({ tree, version: 4 });
        expect(mocks.kvSet).not.toHaveBeenCalled();
        expect(mocks.kvMutate).not.toHaveBeenCalled();
    });

    it('creates the record when the account has none', async () => {
        mocks.kvGet.mockResolvedValue(null);
        mocks.kvSet.mockResolvedValue(0);

        const result = await ensureSessionCategories({} as never);

        expect(result.version).toBe(0);
        expect(result.tree.categories).toEqual([]);
        expect(mocks.kvSet).toHaveBeenCalledWith(
            expect.anything(),
            SESSION_CATEGORIES_KV_KEY,
            expect.any(String),
            -1,
        );
    });

    it('overwrites a corrupt record at its own version, not by creating a new one', async () => {
        // The record exists, so creating would lose the version race and leave
        // the account permanently unreadable.
        mocks.kvGet.mockResolvedValue({
            key: SESSION_CATEGORIES_KV_KEY,
            value: 'not-base64!!',
            version: 9,
        });
        mocks.kvMutate.mockResolvedValue({ success: true, results: [{ key: SESSION_CATEGORIES_KV_KEY, version: 10 }] });

        const result = await ensureSessionCategories({} as never);

        expect(result).toEqual({ tree: { categories: [], assignments: {} }, version: 10 });
        expect(mocks.kvSet).not.toHaveBeenCalled();
        expect(mocks.kvMutate).toHaveBeenCalledWith(
            expect.anything(),
            [expect.objectContaining({ key: SESSION_CATEGORIES_KV_KEY, version: 9 })],
        );
    });

    it('falls back to the stored version when the repair write fails', async () => {
        mocks.kvGet.mockResolvedValue({
            key: SESSION_CATEGORIES_KV_KEY,
            value: 'not-base64!!',
            version: 9,
        });
        mocks.kvMutate.mockResolvedValue({
            success: false,
            errors: [{ key: SESSION_CATEGORIES_KV_KEY, error: 'version-mismatch', version: 11, value: null }],
        });

        // Returns the empty tree either way — the caller gets something usable
        // and the next sync retries the repair.
        const result = await ensureSessionCategories({} as never);
        expect(result.tree.categories).toEqual([]);
    });
});

describe('saveSessionCategories', () => {
    it('sends base64, so the update path accepts it', async () => {
        mocks.kvMutate.mockResolvedValue({
            success: true,
            results: [{ key: SESSION_CATEGORIES_KV_KEY, version: 5 }],
        });

        const result = await saveSessionCategories({} as never, tree, 4);

        expect(result).toEqual({ ok: true, version: 5 });
        const sent = mocks.kvMutate.mock.calls[0][1][0].value as string;
        expect(/^[A-Za-z0-9+/]*={0,2}$/.test(sent)).toBe(true);
        expect(decodeSessionCategories({ key: SESSION_CATEGORIES_KV_KEY, value: sent, version: 5 }))
            .toEqual({ tree, version: 5 });
    });

    it('reports a mismatch with the tree the server holds', async () => {
        mocks.kvMutate.mockResolvedValue({
            success: false,
            errors: [{ key: SESSION_CATEGORIES_KV_KEY, error: 'version-mismatch', version: 6, value: null }],
        });
        mocks.kvGet.mockResolvedValue({
            key: SESSION_CATEGORIES_KV_KEY,
            value: encodeSessionCategories(tree),
            version: 6,
        });

        expect(await saveSessionCategories({} as never, tree, 4)).toEqual({
            ok: false,
            reason: 'version-mismatch',
            current: { tree, version: 6 },
        });
    });

    it('reports no current tree when the conflicting record is unreadable', async () => {
        mocks.kvMutate.mockResolvedValue({
            success: false,
            errors: [{ key: SESSION_CATEGORIES_KV_KEY, error: 'version-mismatch', version: 6, value: null }],
        });
        mocks.kvGet.mockResolvedValue({ key: SESSION_CATEGORIES_KV_KEY, value: '!!', version: 6 });

        expect(await saveSessionCategories({} as never, tree, 4)).toEqual({
            ok: false,
            reason: 'version-mismatch',
            current: null,
        });
    });
});
