import * as React from 'react';
import { View, ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { SessionsList } from './SessionsList';
import { EmptyMainScreen } from './EmptyMainScreen';
import { useHasArchivedSessions, useVisibleSessionListViewData, useActiveCategoryFilter } from '@/hooks/useVisibleSessionListViewData';
import { CategoryChips } from './CategoryChips';
import { useAllMachines, useSettingMutable } from '@/sync/storage';
import { collectMachineChoices } from '@/sync/machineChoices';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
}));

export const SessionsListWrapper = React.memo(({
    topContentInset = 0,
    scrollIndicatorTopInset = 0,
    bottomContentInset = 128,
    onScroll,
}: {
    topContentInset?: number;
    scrollIndicatorTopInset?: number;
    bottomContentInset?: number;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const activeCategoryFilter = useActiveCategoryFilter();
    const hasArchivedSessions = useHasArchivedSessions();
    const machines = useAllMachines({ includeOffline: true });
    const machineChoices = React.useMemo(() => collectMachineChoices(machines), [machines]);
    const hasOnlineMachines = machineChoices.some((machine) => machine.online);
    const [, setHideArchivedSessions] = useSettingMutable('hideInactiveSessions');
    const styles = stylesheet;

    if (sessionListViewData === null) {
        return (
            <View style={styles.container}>
                <View style={[styles.loadingContainerWrapper, { paddingTop: topContentInset }]}>
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                </View>
            </View>
        );
    }

    // With an online machine, an archive-only account renders SessionsList's inline archive
    // control. With no reachable machine, the connection problem is the useful primary state and
    // the archive remains available as its secondary action.
    //
    // A category filter can empty the list too, and that is a third case: the
    // account may hold plenty of sessions and none of them filed where the
    // filter is looking. It keeps the category bar above the message, because
    // that is where the clear chip lives — without it the filter would have no
    // way out on this device.
    if (sessionListViewData.length === 0 && (!hasArchivedSessions || !hasOnlineMachines)) {
        return (
            <View style={styles.container}>
                {activeCategoryFilter && (
                    <View style={{ paddingTop: topContentInset }}>
                        <CategoryChips />
                    </View>
                )}
                <View style={styles.emptyStateContainer}>
                    <View style={[styles.emptyStateContentContainer, activeCategoryFilter ? undefined : { paddingTop: topContentInset, paddingBottom: bottomContentInset }]}>
                        <EmptyMainScreen
                            hasArchivedSessions={hasArchivedSessions}
                            onShowArchived={() => setHideArchivedSessions(false)}
                            filteredTo={activeCategoryFilter?.label ?? null}
                        />
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SessionsList
                topContentInset={topContentInset}
                scrollIndicatorTopInset={scrollIndicatorTopInset}
                bottomContentInset={bottomContentInset}
                onScroll={onScroll}
            />
        </View>
    );
});
