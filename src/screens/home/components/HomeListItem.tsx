import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import AppText from '../../../components/AppText';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import type { HomeItem } from '../home.types';

const HomeListItem = ({ item }: { item: HomeItem }) => (
    <View style={styles.card}>
        <AppText variant="title">{item.description}</AppText>
        <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
            On server - submitted {new Date(item.created_at).toLocaleString()}
        </AppText>
        <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
            {item.image_urls.length} photo{item.image_urls.length === 1 ? '' : 's'}
        </AppText>
        {item.image_urls.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
                {item.image_urls.map((uri, index) => (
                    <Image
                        key={`${item.id}-${index}`}
                        accessibilityLabel={`Server photo ${index + 1}`}
                        source={{ uri }}
                        style={styles.image}
                        resizeMode="cover"
                    />
                ))}
            </ScrollView>
        ) : null}
    </View>
);

const styles = StyleSheet.create({
    card: {
        backgroundColor: defaultTheme.colors.surface,
        borderRadius: defaultTheme.radius.md,
        padding: defaultTheme.spacing.md,
        gap: defaultTheme.spacing.xs,
    },
    images: { gap: defaultTheme.spacing.sm, paddingTop: defaultTheme.spacing.xs },
    image: { width: 72, height: 72, borderRadius: defaultTheme.radius.sm },
});

export default HomeListItem;
