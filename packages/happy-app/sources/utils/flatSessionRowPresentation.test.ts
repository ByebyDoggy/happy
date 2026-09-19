import { describe, expect, it } from 'vitest';

import { resolveFlatSessionRowStatus } from './flatSessionRowPresentation';

function status(state: Parameters<typeof resolveFlatSessionRowStatus>[0]['state'], hasUnread = false, faded = false) {
    return resolveFlatSessionRowStatus({ state, hasUnread, faded });
}

describe('resolveFlatSessionRowStatus', () => {
    describe('a running session', () => {
        it('shimmers and says so', () => {
            expect(status('thinking')).toEqual({
                shimmerTitle: true,
                badge: { tone: 'running', labelKey: 'running' },
            });
        });

        it('still says running when an older result was never read', () => {
            expect(status('thinking', true).badge).toEqual({
                tone: 'running',
                labelKey: 'running',
            });
        });
    });

    describe('a session waiting on the user', () => {
        it('reports a permission request as blocked', () => {
            expect(status('permission_required')).toEqual({
                shimmerTitle: false,
                badge: { tone: 'blocked', labelKey: 'permissionRequired' },
            });
        });

        it('reports a question as blocked', () => {
            expect(status('input_required')).toEqual({
                shimmerTitle: false,
                badge: { tone: 'blocked', labelKey: 'inputRequired' },
            });
        });

        it('outranks an unread result, because the user is what it waits on', () => {
            expect(status('permission_required', true).badge?.tone).toBe('blocked');
            expect(status('input_required', true).badge?.tone).toBe('blocked');
        });

        it('never shimmers — it is not working', () => {
            expect(status('permission_required').shimmerTitle).toBe(false);
            expect(status('input_required').shimmerTitle).toBe(false);
        });
    });

    describe('a finished session', () => {
        it('says the result is ready when it has not been read', () => {
            expect(status('waiting', true)).toEqual({
                shimmerTitle: false,
                badge: { tone: 'ready', labelKey: 'unread' },
            });
        });

        it('says nothing once the result has been read', () => {
            expect(status('waiting', false)).toEqual({
                shimmerTitle: false,
                badge: null,
            });
        });

        it('does not shimmer', () => {
            expect(status('waiting', true).shimmerTitle).toBe(false);
        });
    });

    describe('a session with nothing to report', () => {
        it('says nothing when the machine is unreachable, unread or not', () => {
            expect(status('disconnected', true)).toEqual({
                shimmerTitle: false,
                badge: null,
            });
            expect(status('disconnected', false).badge).toBeNull();
        });

        it('says nothing for a faded row even when it is blocked', () => {
            expect(status('permission_required', true, true)).toEqual({
                shimmerTitle: false,
                badge: null,
            });
        });

        it('says nothing for a faded row that is running', () => {
            expect(status('thinking', false, true)).toEqual({
                shimmerTitle: false,
                badge: null,
            });
        });

        it('never shimmers a faded row', () => {
            expect(status('thinking', false, true).shimmerTitle).toBe(false);
        });
    });
});
