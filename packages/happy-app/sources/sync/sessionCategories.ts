import * as z from 'zod';

/**
 * User-defined categories for sessions — the layer above the archive.
 *
 * The archive answers "is this work finished", which is one axis. This answers
 * "what is this work about", which is not: a session can be an active game
 * project or an abandoned website one. The two are independent, so a category
 * is a plain label a session carries and nothing about the archive changes.
 *
 * A session belongs to **at most one** category. Nesting gives the second axis
 * the user asked for ("开发游戏类" holding its own sub-categories) without the
 * combinatorial cost of tags, and it is the shape a folder tree already has.
 *
 * Storage is the account's KV store, which the server already syncs and
 * version-locks. Nothing here talks to the server, and the server never learns
 * what a category is called: the whole tree is one encrypted-at-rest record
 * under a single key.
 */

/** KV key holding the whole category tree. One record, one version. */
export const SESSION_CATEGORIES_KV_KEY = 'session-categories';

/** Depth cap. Two levels of nesting below a root, so root → child → leaf. */
export const SESSION_CATEGORY_MAX_DEPTH = 3;

const CATEGORY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export const SessionCategorySchema = z.object({
    id: z.string().regex(CATEGORY_ID_PATTERN).describe('Stable id, generated on the device that created it'),
    name: z.string().min(1).max(64).describe('User-visible name, shown in the sidebar'),
    parentId: z.string().regex(CATEGORY_ID_PATTERN).nullable().describe('Null for a top-level category'),
    /** Manual order among siblings; ties fall back to name. */
    order: z.number().int().describe('Position among siblings'),
});

export type SessionCategory = z.infer<typeof SessionCategorySchema>;

export const SessionCategoryTreeSchema = z.object({
    categories: z.array(SessionCategorySchema).describe('Flat list; the tree is derived from parentId'),
    /** sessionId → categoryId. A session with no entry is uncategorised. */
    assignments: z.record(z.string(), z.string()).describe('Which category each session is filed under'),
});

export type SessionCategoryTree = z.infer<typeof SessionCategoryTreeSchema>;

export const EMPTY_SESSION_CATEGORY_TREE: SessionCategoryTree = {
    categories: [],
    assignments: {},
};

export const SESSION_CATEGORY_TREE_VERSION = 1;

/** The envelope written to KV, so a future format change can migrate. */
export const StoredSessionCategoryTreeSchema = z.object({
    version: z.number().int(),
    tree: SessionCategoryTreeSchema,
});

export type StoredSessionCategoryTree = z.infer<typeof StoredSessionCategoryTreeSchema>;
