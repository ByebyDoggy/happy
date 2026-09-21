import * as React from 'react';
import { SessionListViewItem, useLocalSetting, useLocalSettingMutable, useSessionCategories, useSessionCategoriesLoaded, useSessionListViewData, useSetting } from '@/sync/storage';
import { filterProjectGroupSessions } from '@/sync/projectGroups';
import {
    UNCATEGORISED_FILTER,
    filterPointsAtKnownCategory,
    filterSessionListByCategory,
    type SessionCategoryFilter,
} from './sessionCategoryFilter';
import { t } from '@/text';

/**
 * Applies the persistent archive-visibility preference to the session list.
 *
 * The rule is `session.archived`, never `!session.active`: a Rig session that
 * merely lost its connection is still live work and stays on screen, while a
 * session the agent actually retired hides. Both list shapes — the project
 * cards and the flat, date-grouped rows — run that one rule.
 *
 * `buildSessionListViewData` already routes every archived session into the
 * flat tail, so revealing the archive appends rows below the project cards
 * rather than growing them. The project pass here stays as a backstop.
 *
 * The setting behind it is still stored as `hideInactiveSessions`: it is a
 * server-synced settings field (see sync/settings.ts) with no per-field rename
 * migration, so the key stays put and only the local naming reflects what it
 * actually does.
 */
export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const hideArchivedSessions = useSetting('hideInactiveSessions');
    const categories = useSessionCategories();
    const activeCategory = useLocalSetting('activeCategory');

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        const visibleProjects = new Map<number, SessionListViewItem>();
        const visibleProjectSources = new Set<'rig' | 'happy'>();
        data.forEach((item, index) => {
            if (item.type !== 'project') return;
            const project = hideArchivedSessions
                ? filterProjectGroupSessions(item.project, (session) => !session.archived)
                : item.project;
            if (project) {
                visibleProjects.set(index, { ...item, project });
                visibleProjectSources.add(item.source);
            }
        });

        const result: SessionListViewItem[] = [];
        data.forEach((item, index) => {
            if (item.type === 'projects-header') {
                if (visibleProjectSources.has(item.source)) result.push(item);
                return;
            }
            if (item.type === 'project') {
                const project = visibleProjects.get(index);
                if (project) result.push(project);
                return;
            }
            if (item.type === 'active-sessions' || item.type === 'bots') result.push(item);
        });

        // Flat, date-grouped rows trail the project cards. A date header is
        // held back until a row underneath it survives the filter, so hiding
        // the archive never leaves a heading with nothing under it.
        let pendingHeader: SessionListViewItem | null = null;
        for (const item of data) {
            if (item.type === 'header') {
                pendingHeader = item;
                continue;
            }
            if (item.type !== 'session') continue;
            if (hideArchivedSessions && item.session.archived) continue;
            if (pendingHeader) {
                result.push(pendingHeader);
                pendingHeader = null;
            }
            result.push(item);
        }

        return filterSessionListByCategory(result, categories, activeCategory);
    }, [activeCategory, categories, data, hideArchivedSessions]);
}

/**
 * The category the list is filtered to, as a value the UI can act on: null
 * when nothing is filtered, otherwise the filter with a name to show.
 *
 * `label` is null when the filter names a category that no longer exists —
 * the filter is still in force (which is why this reports it at all), it just
 * has no name to put on the clear chip.
 */
export function useActiveCategoryFilter(): { filter: SessionCategoryFilter; label: string | null } | null {
    const categories = useSessionCategories();
    const filter = useLocalSetting('activeCategory');

    return React.useMemo(() => {
        if (filter === null) return null;
        if (filter === UNCATEGORISED_FILTER) {
            return { filter, label: t('sessionCategories.uncategorised') };
        }
        const found = categories.categories.find(category => category.id === filter);
        return { filter, label: found ? found.name : null };
    }, [categories, filter]);
}

/**
 * Clears a filter that names a category the account no longer has.
 *
 * Deleting a category is not the only way to strand one: this device may have
 * been offline when the deletion happened on another. Either way the list
 * stays empty with nothing to explain it, so the filter is dropped rather than
 * left for the user to discover the clear chip.
 */
export function useClearStrandedCategoryFilter(): void {
    const categories = useSessionCategories();
    const [activeCategory, setActiveCategory] = useLocalSettingMutable('activeCategory');
    const loaded = useSessionCategoriesLoaded();

    React.useEffect(() => {
        // Only once the tree is known: before that every filter looks stranded.
        if (!loaded || activeCategory === null) return;
        if (filterPointsAtKnownCategory(categories, activeCategory)) return;
        setActiveCategory(null);
    }, [activeCategory, categories, loaded, setActiveCategory]);
}

/**
 * Whether any archived rows exist. Drives the archive toggle's presence.
 * Keyed off the same `archived` flag the filter above uses.
 */
export function useHasArchivedSessions(): boolean {
    const data = useSessionListViewData();
    return React.useMemo(() => {
        if (!data) return false;
        return data.some((item) => {
            if (item.type === 'project') {
                return item.project.workspaces.some((workspace) =>
                    workspace.sessions.some((session) => session.archived),
                );
            }
            return item.type === 'session' && item.session.archived;
        });
    }, [data]);
}
