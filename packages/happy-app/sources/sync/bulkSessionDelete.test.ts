import { describe, expect, it, vi } from 'vitest';
import {
    BULK_DELETE_CONCURRENCY,
    partitionBulkDeleteTargets,
    runBulkSessionDelete,
    type BulkDeleteTarget,
} from './bulkSessionDelete';

function target(id: string, isBot = false): BulkDeleteTarget {
    return { id, isBot };
}

/** A `deleteOne` that succeeds for every id unless told otherwise. */
function alwaysSucceeds(record?: string[]) {
    return async (id: string) => {
        record?.push(id);
        return { success: true };
    };
}

describe('partitionBulkDeleteTargets', () => {
    it('keeps non-bot rows and pulls bots out of the selection', () => {
        const result = partitionBulkDeleteTargets([
            target('a'),
            target('bot-1', true),
            target('b'),
            target('bot-2', true),
        ]);

        expect(result.deletable.map(t => t.id)).toEqual(['a', 'b']);
        expect(result.skippedBots).toEqual(['bot-1', 'bot-2']);
    });

    it('returns everything when the selection holds no bots', () => {
        const result = partitionBulkDeleteTargets([target('a'), target('b')]);

        expect(result.deletable.map(t => t.id)).toEqual(['a', 'b']);
        expect(result.skippedBots).toEqual([]);
    });

    it('returns nothing deletable when the selection is all bots', () => {
        const result = partitionBulkDeleteTargets([target('bot-1', true)]);

        expect(result.deletable).toEqual([]);
        expect(result.skippedBots).toEqual(['bot-1']);
    });

    it('preserves the selection order so results read in list order', () => {
        const result = partitionBulkDeleteTargets([
            target('z'),
            target('m'),
            target('a'),
        ]);

        expect(result.deletable.map(t => t.id)).toEqual(['z', 'm', 'a']);
    });

    it('handles an empty selection', () => {
        const result = partitionBulkDeleteTargets([]);

        expect(result.deletable).toEqual([]);
        expect(result.skippedBots).toEqual([]);
    });
});

describe('runBulkSessionDelete', () => {
    it('deletes every target and reports them in completion order', async () => {
        const outcome = await runBulkSessionDelete(
            [target('a'), target('b'), target('c')],
            alwaysSucceeds(),
        );

        expect(outcome.deleted).toHaveLength(3);
        expect(outcome.deleted.sort()).toEqual(['a', 'b', 'c']);
        expect(outcome.failed).toEqual([]);
        expect(outcome.skippedBots).toEqual([]);
    });

    it('never calls deleteOne for a bot', async () => {
        const deleteOne = vi.fn(alwaysSucceeds());

        const outcome = await runBulkSessionDelete(
            [target('a'), target('bot-1', true), target('b')],
            deleteOne,
        );

        expect(deleteOne).toHaveBeenCalledTimes(2);
        expect(deleteOne.mock.calls.map(call => call[0]).sort()).toEqual(['a', 'b']);
        expect(outcome.skippedBots).toEqual(['bot-1']);
    });

    it('records a refused row without abandoning the rest', async () => {
        const deleteOne = async (id: string) => (
            id === 'b'
                ? { success: false, message: 'Session not found' }
                : { success: true }
        );

        const outcome = await runBulkSessionDelete(
            [target('a'), target('b'), target('c')],
            deleteOne,
        );

        expect(outcome.deleted.sort()).toEqual(['a', 'c']);
        expect(outcome.failed).toEqual([{ id: 'b', message: 'Session not found' }]);
    });

    it('falls back to a readable message when the server sends none', async () => {
        const outcome = await runBulkSessionDelete(
            [target('a')],
            async () => ({ success: false }),
        );

        expect(outcome.failed).toEqual([
            { id: 'a', message: 'Failed to delete session' },
        ]);
    });

    it('turns a throwing deleteOne into that row’s failure', async () => {
        const deleteOne = async (id: string) => {
            if (id === 'b') {
                throw new Error('Network request failed');
            }
            return { success: true };
        };

        const outcome = await runBulkSessionDelete(
            [target('a'), target('b'), target('c')],
            deleteOne,
        );

        expect(outcome.deleted.sort()).toEqual(['a', 'c']);
        expect(outcome.failed).toEqual([{ id: 'b', message: 'Network request failed' }]);
    });

    it('describes a non-Error throw instead of losing it', async () => {
        const outcome = await runBulkSessionDelete(
            [target('a')],
            async () => { throw 'boom'; },
        );

        expect(outcome.failed).toEqual([{ id: 'a', message: 'Unknown error' }]);
    });

    it('attempts every target exactly once', async () => {
        const seen: string[] = [];
        const ids = Array.from({ length: 23 }, (_, index) => `s${index}`);

        await runBulkSessionDelete(ids.map(id => target(id)), alwaysSucceeds(seen));

        expect(seen).toHaveLength(ids.length);
        expect(new Set(seen).size).toBe(ids.length);
    });

    it('caps in-flight requests at the concurrency limit', async () => {
        let inFlight = 0;
        let peak = 0;
        const ids = Array.from({ length: 20 }, (_, index) => `s${index}`);

        await runBulkSessionDelete(ids.map(id => target(id)), async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight -= 1;
            return { success: true };
        }, BULK_DELETE_CONCURRENCY);

        expect(peak).toBeLessThanOrEqual(BULK_DELETE_CONCURRENCY);
        expect(peak).toBeGreaterThan(1);
    });

    it('does not spawn more workers than there are rows', async () => {
        let inFlight = 0;
        let peak = 0;

        await runBulkSessionDelete([target('a'), target('b')], async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight -= 1;
            return { success: true };
        }, 8);

        expect(peak).toBe(2);
    });

    it('resolves without calling deleteOne when the selection is only bots', async () => {
        const deleteOne = vi.fn(alwaysSucceeds());

        const outcome = await runBulkSessionDelete(
            [target('bot-1', true), target('bot-2', true)],
            deleteOne,
        );

        expect(deleteOne).not.toHaveBeenCalled();
        expect(outcome).toEqual({
            deleted: [],
            failed: [],
            skippedBots: ['bot-1', 'bot-2'],
        });
    });

    it('resolves on an empty selection', async () => {
        const outcome = await runBulkSessionDelete([], alwaysSucceeds());

        expect(outcome).toEqual({ deleted: [], failed: [], skippedBots: [] });
    });

    it('treats a concurrency below one as a single worker', async () => {
        const seen: string[] = [];

        const outcome = await runBulkSessionDelete(
            [target('a'), target('b')],
            alwaysSucceeds(seen),
            0,
        );

        expect(seen.sort()).toEqual(['a', 'b']);
        expect(outcome.deleted.sort()).toEqual(['a', 'b']);
    });
});
