import * as React from 'react';
import { randomUUID } from 'expo-crypto';
import { Modal } from '@/modal';
import { useSessionCategories } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { SESSION_CATEGORY_MAX_DEPTH } from '@/sync/sessionCategories';
import {
    addCategory,
    deleteCategory as deleteCategoryInTree,
    describeCategoryDeletion,
    getCategoryDepth,
    makeCategory,
    renameCategory as renameCategoryInTree,
} from '@/sync/sessionCategoryOps';

/**
 * Creating, renaming, and deleting categories.
 *
 * Every mutation is a read-modify-write against one KV record, so a failure
 * here means another device wrote first. That is surfaced rather than retried:
 * the local tree has already been refreshed from the server by the time the
 * message shows, so the user is looking at the state that beat them.
 */
export function useSessionCategoryActions() {
    const tree = useSessionCategories();

    const apply = React.useCallback(async (
        transform: (current: typeof tree) => typeof tree,
    ): Promise<boolean> => {
        const result = await sync.updateSessionCategories(transform);
        if (result.ok) {
            return true;
        }
        Modal.alert(
            t('common.error'),
            result.reason === 'not-loaded'
                ? t('sessionCategories.notLoaded')
                : t('sessionCategories.conflict'),
        );
        return false;
    }, []);

    const promptForName = React.useCallback(async (
        title: string,
        defaultValue?: string,
    ): Promise<string | null> => {
        const name = await Modal.prompt(title, undefined, {
            placeholder: t('sessionCategories.nameLabel'),
            defaultValue,
            confirmText: t('common.save'),
            cancelText: t('common.cancel'),
        });
        const trimmed = name?.trim();
        return trimmed ? trimmed : null;
    }, []);

    const createCategory = React.useCallback(async () => {
        const name = await promptForName(t('sessionCategories.create'));
        if (!name) return;
        await apply(current => addCategory(
            current,
            makeCategory(current, { id: randomUUID(), name, parentId: null }),
        ));
    }, [apply, promptForName]);

    const createChildCategory = React.useCallback(async (parentId: string) => {
        // Refused here with a message rather than silently flattened to a
        // sibling: the user asked for a child and should learn why they did
        // not get one.
        if (getCategoryDepth(tree.categories, parentId) >= SESSION_CATEGORY_MAX_DEPTH) {
            Modal.alert(t('sessionCategories.tooDeep'));
            return;
        }
        const name = await promptForName(t('sessionCategories.createChild'));
        if (!name) return;
        await apply(current => addCategory(
            current,
            makeCategory(current, { id: randomUUID(), name, parentId }),
        ));
    }, [apply, promptForName, tree.categories]);

    const renameCategory = React.useCallback(async (categoryId: string, currentName: string) => {
        const name = await promptForName(t('sessionCategories.rename'), currentName);
        if (!name || name === currentName) return;
        await apply(current => renameCategoryInTree(current, categoryId, name));
    }, [apply, promptForName]);

    const deleteCategory = React.useCallback(async (categoryId: string) => {
        const impact = describeCategoryDeletion(tree, categoryId);
        const confirmed = await Modal.confirm(
            t('sessionCategories.deleteTitle'),
            t('sessionCategories.deleteMessage', {
                categories: impact.categoryCount,
                sessions: impact.affectedSessionCount,
            }),
            {
                confirmText: t('sessionCategories.deleteConfirm'),
                cancelText: t('common.cancel'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        await apply(current => deleteCategoryInTree(current, categoryId));
    }, [apply, tree]);

    /**
     * The long-press menu on a category chip. Because the menu is about that
     * category, it is anchored there rather than in a separate management
     * screen the user would have to find the same category in again.
     */
    const showCategoryMenu = React.useCallback((categoryId: string, name: string) => {
        Modal.alert(name, undefined, [
            {
                text: t('sessionCategories.rename'),
                onPress: () => { void renameCategory(categoryId, name); },
            },
            {
                text: t('sessionCategories.createChild'),
                onPress: () => { void createChildCategory(categoryId); },
            },
            {
                text: t('sessionCategories.delete'),
                style: 'destructive',
                onPress: () => { void deleteCategory(categoryId); },
            },
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    }, [createChildCategory, deleteCategory, renameCategory]);

    return {
        createCategory,
        createChildCategory,
        renameCategory,
        deleteCategory,
        showCategoryMenu,
    };
}
