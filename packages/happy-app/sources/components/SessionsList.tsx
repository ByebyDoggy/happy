import React from 'react';
import { View, Pressable, FlatList, ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { usePathname, useRouter } from 'expo-router';
import { SessionListViewItem, SessionRowData, useAllMachines, useSessionListViewData, useSetting, useSettingMutable } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { type SessionState, formatLastSeen, vibingMessages } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { ProjectGroup } from './ProjectGroup';
import { FlatSessionRow, flatListBackgroundColor } from './FlatSessionRow';
import { buildFlatSessionRows, toFlatSessionRow, type FlatSessionRowData } from '@/utils/flatSessionList';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHasArchivedSessions, useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { getHarnessName } from '@/utils/harnessCatalog';
import { requestReview } from '@/utils/requestReview';
import { UpdateBanner } from './UpdateBanner';
import { layout } from './layout';
import { useSessionPressHandlers } from '@/hooks/useNavigateToSession';
import { SessionActionsAnchor, SessionActionsPopover } from './SessionActionsPopover';
import { useSessionActionAlert } from '@/hooks/useSessionQuickActions';
import { t } from '@/text';
import { SessionShortcutHintBadge } from './ShortcutHints';
import { ProviderIcon } from './ProviderIcon';
import { buildSessionProjectDisplayGroups } from '@/utils/sessionDisplayOrder';
import { SelectionCheckbox } from './SelectionCheckbox';
import { useArchiveBulkDelete } from '@/hooks/useArchiveBulkDelete';
import { collectArchivedTargets } from '@/hooks/archiveSelection';

type SessionListDisplayItem = SessionListViewItem | {
    type: 'machine-header';
    machineId: string | null;
    machineName: string;
} | {
    type: 'archive-toggle';
    hidden: boolean;
    /** Sits inside the grey heading band rather than floating on the page. */
    banded?: boolean;
    /** Selection mode is open, so the row becomes its toolbar. */
    selecting?: boolean;
    selectedCount?: number;
    allSelected?: boolean;
    canSelect?: boolean;
    deleting?: boolean;
    onStartSelecting?: () => void;
    onCancelSelecting?: () => void;
    onToggleAll?: () => void;
    onDeleteSelected?: () => void;
} | {
    type: 'flat-session';
    row: FlatSessionRowData;
    last: boolean;
    archived?: boolean;
};

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    // The flat variant removes the card/backdrop split entirely, so the page
    // takes the same colour the rows do.
    containerFlat: {
        backgroundColor: flatListBackgroundColor(theme),
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    headerSection: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    // A date heading in the flat list is just a label sitting between rows, so
    // it drops the grey band and keeps the one background the variant uses.
    headerSectionFlat: {
        backgroundColor: flatListBackgroundColor(theme),
        paddingHorizontal: 16,
    },
    archiveToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 12,
    },
    // In the flat list the toggle heads the archive rather than dividing the
    // page. It sits between the rows on the same background they use — the
    // variant has no grey band anywhere.
    archiveToggleBanded: {
        backgroundColor: flatListBackgroundColor(theme),
        paddingTop: 24,
        paddingBottom: 8,
    },
    archiveTogglePressed: {
        opacity: 0.5,
    },
    archiveToggleLine: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    archiveToggleText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    // The toolbar half of the archive-toggle row. It keeps the row's height and
    // band so flipping into selection mode does not shift the list underneath.
    selectionToolbar: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    selectionToolbarButton: {
        paddingVertical: 4,
        paddingHorizontal: 4,
        borderRadius: 8,
    },
    selectionToolbarText: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('regular'),
    },
    selectionToolbarSpacer: {
        flex: 1,
        alignItems: 'center',
    },
    selectionDeleteDisabled: {
        opacity: 0.4,
    },
    selectionDeleteText: {
        fontSize: 14,
        color: theme.colors.status.error,
        ...Typography.default('semiBold'),
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    machineHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 8,
        paddingBottom: 0,
    },
    machineHeaderLine: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    machineHeaderText: {
        maxWidth: '60%',
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginRight: 4,
        ...Typography.default('regular'),
    },
    projectGroup: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: Platform.select({ web: theme.colors.surface, default: theme.colors.surfaceHigh }),
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    projectGroupSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    sessionItem: {
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: 'transparent',
    },
    sessionItemContainer: {
        marginHorizontal: 16,
        marginBottom: 1,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.divider,
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemContainerSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionItemSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    selectionCheckboxSlot: {
        width: 22,
        marginRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionShortcutBadge: {
        flexShrink: 0,
        marginLeft: 8,
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    sessionSubtitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 4,
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 1,
        ...Typography.default(),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginTop: 2,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    avatarContainer: {
        position: 'relative',
        width: 48,
        height: 48,
    },
    draftIconContainer: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    artifactsSection: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: Platform.select({ web: theme.colors.groupped.background, default: 'transparent' }),
    },
    phoneUpdateBanner: {
        paddingBottom: 16,
    },
    phoneUpdateBannerHeader: {
        paddingTop: 4,
    },
}));

const MachineHeader = React.memo(({ machineId, machineName }: {
    machineId: string | null;
    machineName: string;
}) => {    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();

    const handlePress = React.useCallback(() => {
        if (machineId) {
            router.navigate(`/machine/${machineId}` as any);
        }
    }, [machineId, router]);

    return (
        <Pressable
            onPress={handlePress}
            disabled={!machineId}
            accessibilityRole={machineId ? 'button' : undefined}
            style={styles.machineHeader}
            hitSlop={{ top: 8, bottom: 8 }}
        >
            <View style={styles.machineHeaderLine} />
            <Ionicons
                name="desktop-outline"
                size={11}
                color={theme.colors.textSecondary}
                style={{ marginHorizontal: 6 }}
            />
            <Text style={styles.machineHeaderText} numberOfLines={1}>
                {machineName}
            </Text>
            <View style={styles.machineHeaderLine} />
        </Pressable>
    );
});

/**
 * The archive divider, which doubles as the bulk-delete toolbar.
 *
 * One row serves both jobs rather than the toolbar being a separate band, so
 * opening selection mode does not push the archive down the screen while the
 * user is aiming at the rows they just revealed.
 */
const ArchiveToggleRow = React.memo(({ item, onSetHidden }: {
    item: Extract<SessionListDisplayItem, { type: 'archive-toggle' }>;
    onSetHidden: (hidden: boolean) => void;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const bandStyle = item.banded && styles.archiveToggleBanded;

    if (item.selecting) {
        const deleteDisabled = (item.selectedCount ?? 0) === 0 || !!item.deleting;
        return (
            <View style={[styles.archiveToggle, bandStyle]}>
                <Pressable
                    onPress={item.onCancelSelecting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.selectionToolbarButton,
                        pressed && styles.archiveTogglePressed,
                    ]}
                >
                    <Text style={styles.selectionToolbarText}>{t('sidebar.cancelSelection')}</Text>
                </Pressable>

                <View style={styles.selectionToolbarSpacer}>
                    {!!item.canSelect && (
                        <Pressable
                            onPress={item.onToggleAll}
                            accessibilityRole="button"
                            style={({ pressed }) => [
                                styles.selectionToolbarButton,
                                pressed && styles.archiveTogglePressed,
                            ]}
                        >
                            <Text style={styles.selectionToolbarText}>
                                {item.allSelected
                                    ? t('sidebar.deselectAllArchived')
                                    : t('sidebar.selectAllArchived')}
                            </Text>
                        </Pressable>
                    )}
                </View>

                <Pressable
                    onPress={item.onDeleteSelected}
                    disabled={deleteDisabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: deleteDisabled }}
                    style={({ pressed }) => [
                        styles.selectionToolbarButton,
                        deleteDisabled && styles.selectionDeleteDisabled,
                        pressed && styles.archiveTogglePressed,
                    ]}
                >
                    {item.deleting
                        ? <ActivityIndicator size="small" color={theme.colors.status.error} />
                        : (
                            <Text style={styles.selectionDeleteText}>
                                {t('sidebar.deleteSelected', { count: item.selectedCount ?? 0 })}
                            </Text>
                        )}
                </Pressable>
            </View>
        );
    }

    return (
        <View style={[styles.archiveToggle, bandStyle]}>
            <View style={styles.archiveToggleLine} />
            <Pressable
                onPress={() => onSetHidden(!item.hidden)}
                accessibilityRole="button"
                accessibilityState={{ selected: !item.hidden }}
                style={({ pressed }) => [pressed && styles.archiveTogglePressed]}
            >
                <Text style={styles.archiveToggleText}>
                    {item.hidden ? t('sidebar.showArchived') : t('sidebar.hideArchived')}
                </Text>
            </Pressable>
            {!!item.canSelect && (
                <Pressable
                    onPress={item.onStartSelecting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.selectionToolbarButton,
                        pressed && styles.archiveTogglePressed,
                    ]}
                >
                    <Text style={styles.selectionToolbarText}>
                        {t('sidebar.selectArchived')}
                    </Text>
                </Pressable>
            )}
            <View style={styles.archiveToggleLine} />
        </View>
    );
});

export function SessionsList({
    topContentInset = 0,
    scrollIndicatorTopInset = 0,
    bottomContentInset = 128,
    onScroll,
}: {
    topContentInset?: number;
    scrollIndicatorTopInset?: number;
    bottomContentInset?: number;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} = {}) {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const sourceData = useVisibleSessionListViewData();
    // The unfiltered list, used only to enumerate what a bulk delete may act on.
    // `useVisibleSessionListViewData` strips archived rows when the archive is
    // hidden, so collecting targets from it would report an empty selection in
    // exactly the state where the user has not opened the archive yet — and the
    // Select control would never appear.
    const rawData = useSessionListViewData();
    const hasArchivedSessions = useHasArchivedSessions();
    // Stored under its original `hideInactiveSessions` key — synced settings
    // have no rename migration — but it hides archived sessions only.
    const [hideArchivedSessions, setHideArchivedSessions] = useSettingMutable('hideInactiveSessions');
    // The activity-sorted chat list is the default; the project-card hierarchy
    // is offered back through the home filter menu for people who organized
    // around it.
    const flatSessionList = useSetting('sessionListGrouping') !== 'project';
    const machines = useAllMachines();
    const pathname = usePathname();
    const isTablet = useIsTablet();

    // Bulk delete acts on the archive's rows alone, read from the unfiltered
    // list so the set of deletable sessions is the same whether or not the
    // archive is currently revealed.
    const archivedTargets = React.useMemo(
        () => (rawData ? collectArchivedTargets(rawData) : []),
        [rawData],
    );
    const bulkDelete = useArchiveBulkDelete(archivedTargets);
    // Selection mode implies the archive is open: ticking rows the user cannot
    // see would be a trap. This also covers the reverse race — the target list
    // now survives a collapsed archive, so a selection that began while it was
    // open can still be acted on from the toolbar after it was closed.
    const archiveRevealed = !hideArchivedSessions;
    React.useEffect(() => {
        if (bulkDelete.selecting && !archiveRevealed) {
            setHideArchivedSessions(false);
        }
    }, [archiveRevealed, bulkDelete.selecting, setHideArchivedSessions]);
    // Selection is derived once from pathname so the data array stays stable
    // across navigations. This keeps FlatList virtualization intact: only
    // the previously- and newly-selected rows re-render, instead of the
    // whole visible window.
    const selectedSessionId = React.useMemo<string | undefined>(() => {
        if (!isTablet) return undefined;
        if (!pathname.startsWith('/session/')) return undefined;
        return pathname.split('/')[2];
    }, [isTablet, pathname]);

    // Request review
    React.useEffect(() => {
        if (sourceData && sourceData.length > 0) {
            requestReview();
        }
    }, [sourceData && sourceData.length > 0]);

    const data = React.useMemo<SessionListDisplayItem[] | null>(() => {
        if (!sourceData) return sourceData;

        // Selection mode keeps the archive in front of the user even when the
        // rest of the list is collapsed: its rows are in `sourceData` either
        // way, but hiding it mid-selection would look like the delete failed.
        const archiveVisible = !hideArchivedSessions || bulkDelete.selecting;

        // The archive is a flat, date-grouped tail rather than extra rows
        // inside the project cards, so the toggle is the divider that opens
        // it and always sits directly above those rows.
        const archivedRows = archiveVisible
            ? sourceData.filter((item) => (
                item.type === 'header' || item.type === 'session'
            ))
            : [];
        const groupedRows = sourceData.filter((item) => (
            item.type !== 'header' && item.type !== 'session'
        ));
        const archiveToggle: SessionListDisplayItem[] = hasArchivedSessions
            ? [{
                type: 'archive-toggle',
                hidden: hideArchivedSessions,
                selecting: bulkDelete.selecting,
                selectedCount: bulkDelete.selectedCount,
                allSelected: bulkDelete.allSelected,
                canSelect: bulkDelete.canSelect,
                deleting: bulkDelete.deleting,
                onStartSelecting: bulkDelete.startSelecting,
                onCancelSelecting: bulkDelete.cancelSelecting,
                onToggleAll: bulkDelete.toggleAll,
                onDeleteSelected: bulkDelete.requestDelete,
            }]
            : [];

        if (flatSessionList) {
            // A chat list should always float the thing the user just replied
            // to, so the canonical layout is ordered by recent activity.
            const flatRows = buildFlatSessionRows(groupedRows, { sortByActivity: true });
            const flatItems = flatRows.map<SessionListDisplayItem>((row, index) => ({
                type: 'flat-session',
                row,
                last: index === flatRows.length - 1,
            }));
            // The archive is the same column, only retired: its rows get the
            // flat row too rather than reverting to inset cards. The toggle
            // joins the date headings in their grey band, so opening the
            // archive extends that band instead of adding a second divider
            // style above it.
            const flatArchived = archivedRows.map<SessionListDisplayItem>((item, index) => (
                item.type === 'session'
                    ? {
                        type: 'flat-session',
                        row: toFlatSessionRow(item.session),
                        last: index === archivedRows.length - 1,
                        archived: true,
                    }
                    : item
            ));
            const flatToggle = archiveToggle.map<SessionListDisplayItem>((item) => (
                item.type === 'archive-toggle' ? { ...item, banded: true } : item
            ));
            return [...flatItems, ...flatToggle, ...flatArchived];
        }

        const machineGroups = buildSessionProjectDisplayGroups(
            groupedRows,
            machines,
            t('status.unknown'),
        );
        if (machineGroups.length === 0) {
            return [...groupedRows, ...archiveToggle, ...archivedRows];
        }

        const hierarchy = machineGroups.flatMap<SessionListDisplayItem>((group) => [
            {
                type: 'machine-header',
                machineId: group.machineId,
                machineName: group.machineName,
            },
            ...group.projects,
        ]);
        const legacyItems = groupedRows.filter((item) => (
            item.type !== 'project' && item.type !== 'projects-header'
        ));
        return [...legacyItems, ...hierarchy, ...archiveToggle, ...archivedRows];
    }, [
        bulkDelete.allSelected,
        bulkDelete.canSelect,
        bulkDelete.cancelSelecting,
        bulkDelete.deleting,
        bulkDelete.requestDelete,
        bulkDelete.selecting,
        bulkDelete.selectedCount,
        bulkDelete.startSelecting,
        bulkDelete.toggleAll,
        flatSessionList,
        hasArchivedSessions,
        hideArchivedSessions,
        machines,
        sourceData,
    ]);

    // Early return if no data yet
    if (!data) {
        return (
            <View style={[styles.container, flatSessionList && styles.containerFlat]} />
        );
    }

    const keyExtractor = React.useCallback((item: SessionListDisplayItem, index: number) => {
        switch (item.type) {
            case 'bots': return 'bots';
            case 'machine-header': return `machine-header-${JSON.stringify(item.machineId)}`;
            case 'archive-toggle': return 'archive-toggle';
            case 'flat-session': return `flat-session-${item.row.session.id}`;
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'projects-header': return `projects-header-${item.source}`;
            case 'project': return `project-${item.source}-${item.project.machineId ?? 'unknown'}-${item.project.id}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item, index }: { item: SessionListDisplayItem, index: number }) => {
        switch (item.type) {
            case 'bots':
                return (
                    <View>
                        <View style={styles.headerSection}>
                            <Text style={styles.headerText}>Bots</Text>
                        </View>
                        {item.sessions.map((session, botIndex) => (
                            <FlatSessionRow
                                key={session.id}
                                row={toFlatSessionRow(session)}
                                selected={session.id === selectedSessionId}
                                showBorder={botIndex < item.sessions.length - 1}
                            />
                        ))}
                    </View>
                );
            case 'machine-header':
                return (
                    <MachineHeader
                        machineId={item.machineId}
                        machineName={item.machineName}
                    />
                );

            case 'flat-session':
                return (
                    <FlatSessionRow
                        row={item.row}
                        selected={item.row.session.id === selectedSessionId}
                        showBorder={!item.last}
                        archived={item.archived}
                        selection={item.archived && bulkDelete.selecting
                            ? {
                                checked: bulkDelete.selectedIds.has(item.row.session.id),
                                onToggle: () => bulkDelete.toggle(item.row.session.id),
                            }
                            : undefined}
                    />
                );

            case 'archive-toggle':
                return (
                    <ArchiveToggleRow
                        item={item}
                        onSetHidden={setHideArchivedSessions}
                    />
                );

            case 'header':
                return (
                    <View style={[styles.headerSection, flatSessionList && styles.headerSectionFlat]}>
                        <Text style={styles.headerText}>
                            {item.title}
                        </Text>
                    </View>
                );

            case 'active-sessions':
                return (
                    <ActiveSessionsGroupCompact
                        sessions={item.sessions}
                        selectedSessionId={selectedSessionId}
                    />
                );

            case 'projects-header':
                return (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {item.source === 'rig' ? getHarnessName('rig') : t('sidebar.sessionsTitle')}
                        </Text>
                    </View>
                );

            case 'project':
                return (
                    <ProjectGroup
                        project={item.project}
                        selectedSessionId={selectedSessionId}
                    />
                );

            case 'project-group':
                return (
                    <View style={styles.projectGroup}>
                        <Text style={styles.projectGroupTitle}>
                            {item.displayPath}
                        </Text>
                        <Text style={styles.projectGroupSubtitle}>
                            {item.machine.metadata?.displayName || item.machine.metadata?.host || item.machine.id}
                        </Text>
                    </View>
                );

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 ? data[index - 1] : null;
                const nextItem = index < data.length - 1 ? data[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;
                const selected = item.session.id === selectedSessionId;

                return (
                    <SessionItem
                        session={item.session}
                        selected={selected}
                        isFirst={isFirst}
                        isLast={isLast}
                        isSingle={isSingle}
                        selection={bulkDelete.selecting
                            ? {
                                checked: bulkDelete.selectedIds.has(item.session.id),
                                onToggle: () => bulkDelete.toggle(item.session.id),
                            }
                            : undefined}
                    />
                );
        }
    }, [
        bulkDelete.selecting,
        bulkDelete.selectedIds,
        bulkDelete.toggle,
        selectedSessionId,
        data,
        flatSessionList,
    ]);


    // Remove this section as we'll use FlatList for all items now


    const HeaderComponent = React.useCallback(() => {
        const isPhoneLayout = topContentInset > 0;
        return (
            <UpdateBanner
                style={isPhoneLayout ? styles.phoneUpdateBanner : undefined}
                headerStyle={isPhoneLayout ? styles.phoneUpdateBannerHeader : undefined}
            />
        );
    }, [styles.phoneUpdateBanner, styles.phoneUpdateBannerHeader, topContentInset]);

    // Footer removed - all sessions now shown inline

    return (
        <View style={[styles.container, flatSessionList && styles.containerFlat]}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={data}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    extraData={selectedSessionId}
                    contentContainerStyle={{
                        paddingTop: topContentInset,
                        paddingBottom: safeArea.bottom + bottomContentInset,
                        maxWidth: layout.maxWidth,
                    }}
                    ListHeaderComponent={HeaderComponent}
                    automaticallyAdjustsScrollIndicatorInsets={scrollIndicatorTopInset === 0}
                    scrollIndicatorInsets={scrollIndicatorTopInset > 0
                        ? { top: scrollIndicatorTopInset }
                        : undefined}
                    windowSize={5}
                    maxToRenderPerBatch={8}
                    initialNumToRender={12}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                />
            </View>
        </View>
    );
}

const STATUS_CONFIG: Record<SessionState, { color: string; dotColor: string; isPulsing: boolean; isConnected: boolean }> = {
    disconnected: { color: '#999', dotColor: '#999', isPulsing: false, isConnected: false },
    thinking: { color: '#007AFF', dotColor: '#007AFF', isPulsing: true, isConnected: true },
    waiting: { color: '#34C759', dotColor: '#34C759', isPulsing: false, isConnected: true },
    permission_required: { color: '#FF9500', dotColor: '#FF9500', isPulsing: true, isConnected: true },
    input_required: { color: '#FF9500', dotColor: '#FF9500', isPulsing: true, isConnected: true },
};

const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle, selection }: {
    session: SessionRowData;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    /** Set only for archive rows while selection mode is open. */
    selection?: { checked: boolean; onToggle: () => void };
}) => {
    const styles = stylesheet;
    const sessionPressHandlers = useSessionPressHandlers(session.id);
    const [actionsAnchor, setActionsAnchor] = React.useState<SessionActionsAnchor | null>(null);
    const selecting = !!selection;
    const baseStatus = STATUS_CONFIG[session.state];
    const needsUserAction = session.state === 'permission_required' || session.state === 'input_required';
    // User action stays orange and pulsing even when the request also marked the session unread.
    const status = session.hasUnread && !needsUserAction
        ? { ...baseStatus, color: '#007AFF', dotColor: '#007AFF', isPulsing: false, isConnected: baseStatus.isConnected }
        : baseStatus;

    const vibingMessage = React.useMemo(() => {
        return vibingMessages[Math.floor(Math.random() * vibingMessages.length)].toLowerCase() + '…';
    }, [session.state]);

    const statusText = session.state === 'input_required'
        ? t('status.inputRequired')
        : session.state === 'permission_required'
            ? t('status.permissionRequired')
            : session.hasUnread
                ? t('status.unread')
                : session.state === 'thinking'
                    ? vibingMessage
                    : session.state === 'disconnected'
                        ? t('status.lastSeen', { time: formatLastSeen(session.activeAt!, false) })
                        : t('status.online');

    const handleContextMenu = React.useCallback((event: any) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        setActionsAnchor({
            type: 'point',
            x: event.nativeEvent.clientX ?? event.nativeEvent.pageX ?? 0,
            y: event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0,
        });
    }, []);

    const showActionAlert = useSessionActionAlert(session.id);
    const menuProps = Platform.OS === 'web' ? {
        onContextMenu: selecting ? undefined : handleContextMenu,
    } as any : {
        onLongPress: selecting ? selection?.onToggle : showActionAlert,
    };

    return (
        <View style={[
            styles.sessionItemContainer,
            isSingle ? styles.sessionItemContainerSingle :
                isFirst ? styles.sessionItemContainerFirst :
                    isLast ? styles.sessionItemContainerLast : {}
        ]}>
        <Pressable
            style={[
                styles.sessionItem,
                selected && styles.sessionItemSelected,
                isSingle ? styles.sessionItemSingle :
                    isFirst ? styles.sessionItemFirst :
                        isLast ? styles.sessionItemLast : {}
            ]}
            {...(selecting
                ? {
                    onPress: selection?.onToggle,
                    accessibilityRole: 'checkbox' as const,
                    accessibilityState: { checked: selection?.checked ?? false },
                }
                : sessionPressHandlers)}
            {...menuProps}
        >
            {selecting && (
                <View style={styles.selectionCheckboxSlot}>
                    <SelectionCheckbox checked={selection?.checked ?? false} />
                </View>
            )}
            <View style={styles.avatarContainer}>
                <Avatar bot={!!session.botId} id={session.avatarId} size={48} monochrome={!status.isConnected} flavor={session.flavor} clientId={session.clientId} imageUrl={session.avatarUri} thumbhash={session.avatarThumbhash} badgeLocation="sessionList" />
                {session.hasDraft && (
                    <View style={styles.draftIconContainer}>
                        <Ionicons
                            name="create-outline"
                            size={12}
                            style={styles.draftIconOverlay}
                        />
                    </View>
                )}
            </View>
            <View style={styles.sessionContent}>
                <View style={styles.sessionTitleRow}>
                    <Text style={[
                        styles.sessionTitle,
                        status.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                    ]} numberOfLines={1}>
                        {session.name}
                    </Text>
                    <SessionShortcutHintBadge
                        sessionId={session.id}
                        style={styles.sessionShortcutBadge}
                    />
                </View>

                {session.identityLine ? (
                    <View style={styles.sessionSubtitleRow}>
                        <ProviderIcon kind={session.providerKind} size={13} />
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                            {session.identityLine}
                        </Text>
                    </View>
                ) : session.path ? (
                    <View style={styles.sessionSubtitleRow}>
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                            {session.path.split(/[/\\]/).filter(Boolean).pop()}
                        </Text>
                    </View>
                ) : (
                    <Text style={styles.sessionSubtitle} numberOfLines={1}>
                        {session.botId ? toFlatSessionRow(session).projectName : session.subtitle}
                    </Text>
                )}

                <View style={styles.statusRow}>
                    <View style={styles.statusDotContainer}>
                        <StatusDot color={status.dotColor} isPulsing={status.isPulsing} />
                    </View>
                    <Text style={[
                        styles.statusText,
                        { color: status.color }
                    ]}>
                        {session.modelName ? `${session.modelName} · ` : ''}{statusText}{session.activitySummary ? ` · ${session.activitySummary}` : ''}
                    </Text>
                </View>
            </View>
        </Pressable>
        {Platform.OS === 'web' && (
            <SessionActionsPopover
                anchor={actionsAnchor}
                onClose={() => setActionsAnchor(null)}
                sessionId={session.id}
                visible={!!actionsAnchor}
            />
        )}
        </View>
    );
});
