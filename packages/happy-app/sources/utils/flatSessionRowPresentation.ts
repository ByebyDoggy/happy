import type { SessionState } from '@/sync/sessionState';

/**
 * What a flat list row shows about its session's progress.
 *
 * One resolver owns both signals a row carries — the title's shimmer and the
 * status pill — because they read the same three inputs and must agree: a row
 * cannot be shimmering "alive" while its badge says it is waiting on the user.
 * Keeping them in one place is also what makes that agreement testable.
 *
 * The top-right corner is deliberately not part of this. It always shows the
 * timestamp: the pill already carries colour and now carries the word too, so
 * a second coloured dot in the same row would be the same fact twice.
 */
export type SessionStatusBadgeTone = 'running' | 'blocked' | 'ready';

export interface SessionStatusBadge {
    tone: SessionStatusBadgeTone;
    /** A translation key under `status`. */
    labelKey: 'running' | 'permissionRequired' | 'inputRequired' | 'unread';
}

export interface FlatSessionRowStatus {
    /** The title carries a slow pulse, the way a chat list marks live work. */
    shimmerTitle: boolean;
    /** Null when the row has nothing to report. */
    badge: SessionStatusBadge | null;
}

/**
 * `waiting` and `disconnected` deliberately resolve to no badge: an idle
 * session someone has already read is the resting state of the list, and a pill
 * on every one of those would be noise that makes the rows which do need an
 * answer harder to find. The timestamp alone is right there.
 *
 * The `state` switch is exhaustive over `SessionState` on purpose, so a state
 * added later fails to compile here instead of silently rendering nothing.
 */
export function resolveFlatSessionRowStatus({
    state,
    hasUnread,
    faded,
}: {
    state: SessionState;
    hasUnread: boolean;
    faded: boolean;
}): FlatSessionRowStatus {
    // A faded row is retired work, or work whose machine is gone. Neither is
    // something the user can act on from this list, so it reports nothing.
    if (faded) {
        return { shimmerTitle: false, badge: null };
    }

    switch (state) {
        case 'permission_required':
            return { shimmerTitle: false, badge: { tone: 'blocked', labelKey: 'permissionRequired' } };
        case 'input_required':
            return { shimmerTitle: false, badge: { tone: 'blocked', labelKey: 'inputRequired' } };
        case 'thinking':
            return { shimmerTitle: true, badge: { tone: 'running', labelKey: 'running' } };
        case 'waiting':
            // Finished, and the result has not been looked at yet.
            return {
                shimmerTitle: false,
                badge: hasUnread ? { tone: 'ready', labelKey: 'unread' } : null,
            };
        case 'disconnected':
            return { shimmerTitle: false, badge: null };
    }
}
