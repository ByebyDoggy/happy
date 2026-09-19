import { describe, expect, it } from 'vitest';
import {
    buildBulkDeleteReport,
    firstFailureMessage,
    needsBulkDeleteReport,
} from './bulkDeleteReport';
import type { BulkDeleteOutcome } from './bulkSessionDelete';

function outcome(parts: Partial<BulkDeleteOutcome> = {}): BulkDeleteOutcome {
    return {
        deleted: parts.deleted ?? [],
        failed: parts.failed ?? [],
        skippedBots: parts.skippedBots ?? [],
    };
}

describe('buildBulkDeleteReport', () => {
    it('counts each bucket', () => {
        const report = buildBulkDeleteReport(outcome({
            deleted: ['a', 'b'],
            failed: [{ id: 'c', message: 'gone' }],
            skippedBots: ['bot-1'],
        }));

        expect(report).toEqual({
            deletedCount: 2,
            failedCount: 1,
            skippedBotCount: 1,
            hasFailures: true,
        });
    });

    it('reports a clean run as having no failures', () => {
        const report = buildBulkDeleteReport(outcome({ deleted: ['a'] }));

        expect(report.hasFailures).toBe(false);
        expect(report.deletedCount).toBe(1);
    });

    it('does not treat skipped bots as failures', () => {
        const report = buildBulkDeleteReport(outcome({
            deleted: ['a'],
            skippedBots: ['bot-1'],
        }));

        expect(report.hasFailures).toBe(false);
        expect(report.skippedBotCount).toBe(1);
    });

    it('handles an empty outcome', () => {
        expect(buildBulkDeleteReport(outcome())).toEqual({
            deletedCount: 0,
            failedCount: 0,
            skippedBotCount: 0,
            hasFailures: false,
        });
    });
});

describe('firstFailureMessage', () => {
    it('returns the first failure message', () => {
        const message = firstFailureMessage(outcome({
            failed: [
                { id: 'a', message: 'Session not found' },
                { id: 'b', message: 'Network request failed' },
            ],
        }));

        expect(message).toBe('Session not found');
    });

    it('returns null when nothing failed', () => {
        expect(firstFailureMessage(outcome({ deleted: ['a'] }))).toBeNull();
    });
});

describe('needsBulkDeleteReport', () => {
    it('is false when every row the user picked was deleted', () => {
        expect(needsBulkDeleteReport(outcome({ deleted: ['a', 'b'] }))).toBe(false);
    });

    it('is true when a row failed', () => {
        expect(needsBulkDeleteReport(outcome({
            deleted: ['a'],
            failed: [{ id: 'b', message: 'gone' }],
        }))).toBe(true);
    });

    it('is true when a bot was skipped, so the user learns it survived', () => {
        expect(needsBulkDeleteReport(outcome({
            deleted: ['a'],
            skippedBots: ['bot-1'],
        }))).toBe(true);
    });

    it('is false for an empty outcome', () => {
        expect(needsBulkDeleteReport(outcome())).toBe(false);
    });
});
