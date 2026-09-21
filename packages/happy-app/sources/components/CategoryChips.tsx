import * as React from 'react';
import { ScrollView, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { buildCategoryNodes, type CategoryNode } from '@/sync/sessionCategoryOps';
import type { SessionCategoryTree } from '@/sync/sessionCategories';
import { UNCATEGORISED_FILTER, type SessionCategoryFilter } from '@/hooks/sessionCategoryFilter';
import { useLocalSettingMutable, useSessionCategories } from '@/sync/storage';
import { useSessionCategoryActions } from '@/hooks/useSessionCategoryActions';

/**
 * The category bar above the session list: one chip per category, plus All,
 * Uncategorised, and a create button.
 *
 * A horizontally scrolling row rather than a sidebar, because the sidebar this
 * feature was first imagined as only exists on tablet and desktop — the phone
 * is where the session list actually needs the filter, and it has no room for a
 * persistent column.
 *
 * Tapping filters, long-pressing manages. The two gestures on one target is
 * deliberate: a category's own menu is about that category, so it belongs on
 * the category rather than in a separate management screen.
 *
 * Because the row scrolls, the "All" chip is not always on screen — tapping it
 * is not a dependable way back to the unfiltered list, which is what the
 * banner at the right end is for. It appears only while a filter is active and
 * never scrolls away, so there is always exactly one visible way out.
 */
export const CategoryChips = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const tree = useSessionCategories();
    const [activeCategory, setActiveCategory] = useLocalSettingMutable('activeCategory');
    const actions = useSessionCategoryActions();

    // Nested categories are shown flat with an indent: a chip row has one line
    // of height, so depth has to be carried by padding rather than by nesting.
    const rows = React.useMemo(() => flattenNodes(buildCategoryNodes(tree)), [tree]);

    const hasCategories = tree.categories.length > 0;
    // The uncategorised chip only means something once something is filed;
    // before that it would filter to the same list "All" already shows.
    const hasFiledSessions = Object.keys(tree.assignments).length > 0;

    // The name to show on the way out, resolved from whichever filter is set.
    const activeLabel = React.useMemo(() => {
        if (activeCategory === null) return null;
        if (activeCategory === UNCATEGORISED_FILTER) {
            return t('sessionCategories.uncategorised');
        }
        const found = rows.find(({ node }) => node.category.id === activeCategory);
        // A filter naming a category that no longer exists still needs a way
        // out, so the missing name falls back to the generic one.
        return found ? found.node.category.name : t('sessionCategories.title');
    }, [activeCategory, rows]);

    const select = React.useCallback((filter: SessionCategoryFilter) => {
        // Tapping the active chip clears the filter, so the row is its own way
        // back to the full list without hunting for "All".
        setActiveCategory(activeCategory === filter ? null : filter);
    }, [activeCategory, setActiveCategory]);

    // With no categories and no filter, the row would be a lone "+": one chip
    // of chrome over the whole list for a feature that is not in use yet.
    //
    // The `activeCategory` half of the condition matters. A filter can outlive
    // the category it named — deleted on another device, or this is the device
    // that deleted the last one — and that state must still draw the row, or
    // the list stays filtered with nothing on screen able to clear it.
    if (!hasCategories && activeCategory === null) {
        return (
            <View style={styles.container}>
                <Pressable onPress={actions.createCategory} style={styles.addChip}>
                    <Ionicons name="add" size={14} color={theme.colors.textSecondary} />
                    <Text style={styles.addChipText}>{t('sessionCategories.create')}</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            style={styles.container}
        >
            <Chip
                label={t('sessionCategories.all')}
                active={activeCategory === null}
                onPress={() => setActiveCategory(null)}
            />

            {rows.map(({ node, depth }) => (
                <Chip
                    key={node.category.id}
                    label={node.category.name}
                    count={node.totalCount}
                    depth={depth}
                    active={activeCategory === node.category.id}
                    onPress={() => select(node.category.id)}
                    onLongPress={() => actions.showCategoryMenu(node.category.id, node.category.name)}
                />
            ))}

            {hasCategories && (
                <Chip
                    label={t('sessionCategories.uncategorised')}
                    active={activeCategory === UNCATEGORISED_FILTER}
                    onPress={() => select(UNCATEGORISED_FILTER)}
                    muted
                    hidden={!hasFiledSessions}
                />
            )}

            <Pressable
                onPress={actions.createCategory}
                accessibilityRole="button"
                accessibilityLabel={t('sessionCategories.create')}
                style={({ pressed }) => [styles.addChip, pressed && styles.chipPressed]}
            >
                <Ionicons name="add" size={14} color={theme.colors.textSecondary} />
            </Pressable>

            {/* Pinned to the end of the row rather than the start: the chips
                grow rightward, so the end is where the user's thumb already
                is after picking one — and it is the one control that must not
                scroll out of reach. */}
            {activeLabel !== null && (
                <Pressable
                    onPress={() => setActiveCategory(null)}
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionCategories.showAll')}
                    style={({ pressed }) => [styles.clearChip, pressed && styles.chipPressed]}
                >
                    <Text style={styles.clearChipText} numberOfLines={1}>
                        {activeLabel}
                    </Text>
                    <Ionicons name="close-circle" size={14} color={theme.colors.box.info.text} />
                </Pressable>
            )}
        </ScrollView>
    );
});

const Chip = React.memo(({ label, count, active, depth = 0, muted, hidden, onPress, onLongPress }: {
    label: string;
    count?: number;
    active: boolean;
    /** Nesting level, carried as padding since the row is one line tall. */
    depth?: number;
    muted?: boolean;
    hidden?: boolean;
    onPress: () => void;
    onLongPress?: () => void;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    if (hidden) return null;

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                pressed && styles.chipPressed,
            ]}
        >
            {depth > 0 && <View style={styles.childIndent} />}
            <Text
                style={[
                    styles.chipText,
                    muted && !active && styles.chipTextMuted,
                    active && styles.chipTextActive,
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
            {count !== undefined && count > 0 && (
                <Text style={[styles.chipCount, active && styles.chipTextActive]}>{count}</Text>
            )}
        </Pressable>
    );
});

function flattenNodes(nodes: readonly CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
    const out: { node: CategoryNode; depth: number }[] = [];
    for (const node of nodes) {
        out.push({ node, depth });
        out.push(...flattenNodes(node.children, depth + 1));
    }
    return out;
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexGrow: 0,
        flexShrink: 0,
    },
    scrollContent: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 6,
        alignItems: 'center',
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 9999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        maxWidth: 180,
    },
    chipActive: {
        backgroundColor: theme.colors.surfaceSelected,
        borderColor: theme.colors.textSecondary,
    },
    chipPressed: {
        opacity: 0.6,
    },
    // A child chip is marked by a small leading bar rather than by indentation
    // alone, which a single-line row cannot show convincingly.
    childIndent: {
        width: 2,
        height: 12,
        borderRadius: 1,
        backgroundColor: theme.colors.divider,
    },
    chipText: {
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('regular'),
    },
    chipTextMuted: {
        color: theme.colors.textSecondary,
    },
    chipTextActive: {
        ...Typography.default('semiBold'),
    },
    chipCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    addChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 9999,
        borderWidth: StyleSheet.hairlineWidth,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
    },
    addChipText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    // The way out of a filter. Blue like an active chip, but with a close icon,
    // so it reads as "you are here, tap to leave" rather than as another
    // category to select.
    clearChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 9999,
        backgroundColor: theme.colors.box.info.background,
        maxWidth: 180,
    },
    clearChipText: {
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.box.info.text,
        ...Typography.default('semiBold'),
    },
}));
