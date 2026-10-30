import Toast from 'react-native-toast-message';

export const showSuccessToast = (title: string, message?: string): void => {
    Toast.show({
        type: 'success',
        text1: title,
        text2: message,
    });
};

export const showErrorToast = (title: string, message?: string): void => {
    Toast.show({
        type: 'error',
        text1: title,
        text2: message,
    });
};

export const showInfoToast = (title: string, message?: string): void => {
    Toast.show({
        type: 'info',
        text1: title,
        text2: message,
    });
};
