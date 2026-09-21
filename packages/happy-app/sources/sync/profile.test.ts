import { describe, expect, it } from 'vitest';
import { GitHubProfileSchema, ProfileSchema, profileParse } from './profile';

/**
 * The server relays GitHub's profile object as-is, so every field carries
 * GitHub's nullability rather than the app's preferences. A user who has not
 * filled in a name or made an email public gets `null` for both — which is the
 * common case, not the edge case.
 */
describe('GitHubProfileSchema', () => {
    const base = {
        id: 130195553,
        login: 'ByebyDoggy',
        avatar_url: 'https://avatars.githubusercontent.com/u/130195553?v=4',
        bio: null,
    };

    it('accepts a profile whose name and email are null', () => {
        // The shape that broke it: a real account with no name set and no
        // public email.
        const result = GitHubProfileSchema.safeParse({ ...base, name: null, email: null });

        expect(result.success).toBe(true);
    });

    it('accepts a fully filled profile', () => {
        const result = GitHubProfileSchema.safeParse({
            ...base, name: 'Someone', email: 'someone@example.com',
        });

        expect(result.success).toBe(true);
    });

    it('rejects a profile missing the fields the app actually renders', () => {
        expect(GitHubProfileSchema.safeParse({ ...base, login: undefined }).success).toBe(false);
        expect(GitHubProfileSchema.safeParse({ ...base, avatar_url: undefined }).success).toBe(false);
    });
});

describe('profileParse', () => {
    it('parses the exact response the server returns for a connected account', () => {
        // Captured from POST /v1/account/profile on a real account.
        const result = profileParse({
            id: 'cm4x7k2',
            timestamp: 1758400000000,
            firstName: null,
            lastName: null,
            avatar: null,
            username: 'ByebyDoggy',
            github: {
                id: 130195553,
                login: 'ByebyDoggy',
                name: null,
                avatar_url: 'https://avatars.githubusercontent.com/u/130195553?v=4',
                email: null,
                bio: null,
                type: 'User',
                public_repos: 53,
            },
            connectedServices: [],
        });

        expect(result.github?.login).toBe('ByebyDoggy');
        expect(result.github?.name).toBeNull();
    });

    it('tolerates the extra fields GitHub sends, which the schema strips', () => {
        const result = ProfileSchema.safeParse({
            id: 'x',
            timestamp: 1,
            firstName: null,
            lastName: null,
            avatar: null,
            github: {
                id: 1,
                login: 'a',
                name: null,
                avatar_url: 'u',
                email: null,
                bio: null,
                node_id: 'U_kgDOB8KgYQ',
                site_admin: false,
                public_repos: 53,
            },
            connectedServices: [],
        });

        expect(result.success).toBe(true);
        // Stripped, not preserved — the app never reads them.
        expect(result.success && result.data.github).not.toHaveProperty('node_id');
    });
});
