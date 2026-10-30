import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import AppText from './AppText';

interface DynamicModalProps {
    visible: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}

const { colors, radius, spacing } = defaultTheme;

const DynamicModal = ({ visible, onClose, title, children }: DynamicModalProps) => {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.card} onPress={() => undefined}>
                    {title ? (
                        <AppText variant="title" style={styles.title}>
                            {title}
                        </AppText>
                    ) : null}
                    <View>{children}</View>
                </Pressable>
            </Pressable>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        padding: spacing.lg,
    },
    card: {
        backgroundColor: colors.background,
        borderRadius: radius.lg,
        padding: spacing.lg,
    },
    title: { marginBottom: spacing.md },
});

export default DynamicModal;
