import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { SessionStatusBadge } from '@/utils/flatSessionRowPresentation';

/**
 * The status pill on a session row: the word, in the colour that word already
 * has elsewhere in the app.
 *
 * It replaces the plain dot the flat list used to draw. A dot is only legible
 * once you have learned it, which is exactly the cost this is here to remove —
 * the list should say what a session is doing without being opened.
 *
 * Only the three tones that carry information get one. An idle, read session
 * shows nothing, because a pill on every row would bury the ones that matter.
 */
export const SessionStatusBadgePill = React.memo(({ badge }: { badge: SessionStatusBadge }) => {
    // Running reads as ordinary activity, blocked as something the user has to
    // clear, ready as a result waiting to be looked at. Those are the meanings
    // the rest of the app already gives blue and orange.
    const blocked = badge.tone === 'blocked';
    return (
        <View style={[stylesheet.pill, blocked ? stylesheet.pillBlocked : stylesheet.pillInfo]}>
            <Text style={[stylesheet.label, blocked ? stylesheet.labelBlocked : stylesheet.labelInfo]} numberOfLines={1}>
                {t(`status.${badge.labelKey}`)}
            </Text>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    pill: {
        flexShrink: 0,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 9999,
    },
    pillInfo: {
        backgroundColor: theme.colors.box.info.background,
    },
    pillBlocked: {
        backgroundColor: theme.colors.box.warning.background,
    },
    label: {
        fontSize: 11,
        lineHeight: 15,
        ...Typography.default('semiBold'),
    },
    labelInfo: {
        color: theme.colors.box.info.text,
    },
    labelBlocked: {
        color: theme.colors.box.warning.text,
    },
}));
