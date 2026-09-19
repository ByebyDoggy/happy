import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';

/**
 * The tick shown on a list row while the archive is in selection mode.
 *
 * Purely presentational: the row it sits in owns the press target, so the whole
 * row toggles rather than a small box the thumb has to find. That also keeps
 * the hit area accessible — a 22pt box inside a 60pt row would otherwise need
 * its own hitSlop.
 */
export const SelectionCheckbox = React.memo(({ checked }: { checked: boolean }) => {
    return (
        <View
            style={[
                styles.box,
                checked ? styles.boxChecked : styles.boxUnchecked,
            ]}
            pointerEvents="none"
        >
            {checked && (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    box: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    boxUnchecked: {
        borderWidth: 1.5,
        borderColor: theme.colors.textSecondary,
        backgroundColor: 'transparent',
    },
    // `radio.active` rather than `button.primary.background`: the primary button
    // is black in both themes, which is invisible as a tick on a dark page.
    boxChecked: {
        backgroundColor: theme.colors.radio.active,
    },
}));
