import { describe, expect, it, vi } from 'vitest';
import {
    CATEGORY_WRITE_ATTEMPTS,
    writeSessionCategories,
    type CategoryWriteIo,
} from './sessionCategoryWrite';
import type { SessionCategoryTree } from './sessionCategories';

function tree(assignments: Record<string, string> = {}): SessionCategoryTree {
    return {
        categories: [{ id: 'game', name: 'Game', parentId: null, order: 0 }],
        assignments,
    };
}

/**
 * A stand-in server holding one record at one version, plus this device's view
 * of it.
 *
 * The two versions are tracked separately on purpose: `readVersion` must report
 * what this device last *read*, which lags the server whenever another write
 * lands in between. A fake that returned the server's version from
 * `readVersion` could never produce a mismatch at all.
 *
 * `write` succeeds when the caller's version matches and otherwise returns what
 * the server holds — the KV store's optimistic-lock contract.
 */
function fakeIo(options: { serverVersion?: number; serverTree?: SessionCategoryTree } = {}) {
    let serverVersion = options.serverVersion ?? 0;
    let serverTree = options.serverTree ?? tree();
    let localVersion = serverVersion;

    const io: CategoryWriteIo = {
        readLocal: () => serverTree,
        readVersion: () => localVersion,
        isLoaded: () => true,
        write: vi.fn(async (next: SessionCategoryTree, version: number) => {
            if (version !== serverVersion) {
                return { ok: false as const, current: { tree: serverTree, version: serverVersion } };
            }
            serverVersion += 1;
            serverTree = next;
            return { ok: true as const, version: serverVersion };
        }),
        publish: vi.fn((next: SessionCategoryTree, version: number) => {
            serverTree = next;
            localVersion = version;
        }),
    };
    return {
        io,
        getTree: () => serverTree,
        getVersion: () => serverVersion,
        /** Another writer advances the server without this device noticing. */
        bumpServer: (extra: SessionCategoryTree) => {
            serverTree = extra;
            serverVersion += 1;
        },
    };
}

describe('writeSessionCategories', () => {
    it('writes a transform that fits in one attempt', async () => {
        const { io, getTree } = fakeIo();

        const result = await writeSessionCategories(io, t => ({ ...t, assignments: { s1: 'game' } }));

        expect(result).toEqual({ ok: true });
        expect(getTree().assignments).toEqual({ s1: 'game' });
        expect(io.write).toHaveBeenCalledTimes(1);
    });

    it('refuses to write before the record has been read', async () => {
        const { io } = fakeIo();
        const unloaded: CategoryWriteIo = { ...io, isLoaded: () => false };

        const result = await writeSessionCategories(unloaded, t => t);

        expect(result).toEqual({ ok: false, reason: 'not-loaded' });
        expect(io.write).not.toHaveBeenCalled();
    });

    it('retries when the version moved between the read and the write', async () => {
        const { io, bumpServer, getTree } = fakeIo();
        // Another write lands after this device last read.
        bumpServer(tree({ s9: 'game' }));

        const result = await writeSessionCategories(io, t => ({ ...t, assignments: { s1: 'game' } }));

        expect(result).toEqual({ ok: true });
        expect(io.write).toHaveBeenCalledTimes(2);
        expect(getTree().assignments).toEqual({ s1: 'game' });
    });

    it('replays the transform against the server tree, not the stale local one', async () => {
        const { io, bumpServer } = fakeIo();
        bumpServer(tree({ s9: 'game' }));

        // A transform that adds rather than replaces: the server's s9 must
        // survive, which only holds if the replay saw the newer tree.
        await writeSessionCategories(io, t => ({
            ...t,
            assignments: { ...t.assignments, s1: 'game' },
        }));

        const lastCall = vi.mocked(io.write).mock.calls.at(-1)!;
        expect(lastCall[0].assignments).toEqual({ s9: 'game', s1: 'game' });
    });

    it('absorbs several intervening writes', async () => {
        const { io, getTree } = fakeIo();
        let bumps = 0;
        const racing: CategoryWriteIo = {
            ...io,
            write: vi.fn(async (next, version) => {
                // Lose the first two attempts to a writer we never see.
                if (bumps < 2) {
                    bumps += 1;
                    return { ok: false as const, current: { tree: tree(), version: version + 1 } };
                }
                return { ok: true as const, version: version + 1 };
            }),
        };

        const result = await writeSessionCategories(racing, t => t);

        expect(result).toEqual({ ok: true });
        expect(racing.write).toHaveBeenCalledTimes(3);
    });

    it('gives up once the attempts are exhausted', async () => {
        const { io } = fakeIo();
        let version = 0;
        const alwaysBeaten: CategoryWriteIo = {
            ...io,
            write: vi.fn(async (_next, current) => {
                version = current + 1;
                return { ok: false as const, current: { tree: tree(), version } };
            }),
        };

        const result = await writeSessionCategories(alwaysBeaten, t => t);

        expect(result).toEqual({ ok: false, reason: 'version-mismatch' });
        expect(alwaysBeaten.write).toHaveBeenCalledTimes(CATEGORY_WRITE_ATTEMPTS);
    });

    it('does not retry when the re-read also failed', async () => {
        const { io } = fakeIo();
        const offline: CategoryWriteIo = {
            ...io,
            write: vi.fn(async () => ({ ok: false as const, current: null })),
        };

        const result = await writeSessionCategories(offline, t => t);

        expect(result).toEqual({ ok: false, reason: 'version-mismatch' });
        expect(offline.write).toHaveBeenCalledTimes(1);
    });

    it('publishes the written tree at the version the server assigned', async () => {
        const { io } = fakeIo({ serverVersion: 7 });

        await writeSessionCategories(io, t => ({ ...t, assignments: { s1: 'game' } }));

        expect(io.publish).toHaveBeenCalledWith(
            expect.objectContaining({ assignments: { s1: 'game' } }),
            8,
        );
    });

    it('adopts the conflicting tree so the next attempt builds on it', async () => {
        const { io, bumpServer } = fakeIo();
        bumpServer(tree({ s9: 'game' }));

        await writeSessionCategories(io, t => t);

        expect(io.publish).toHaveBeenCalledWith(
            expect.objectContaining({ assignments: { s9: 'game' } }),
            expect.any(Number),
        );
    });

    it('reports success without publishing twice on a clean write', async () => {
        const { io } = fakeIo();

        await writeSessionCategories(io, t => t);

        expect(io.publish).toHaveBeenCalledTimes(1);
    });
});
