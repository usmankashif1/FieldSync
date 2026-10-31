import React, { useEffect } from 'react';
import { AppState, StatusBar } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { store } from './src/store/store';
import RootNavigator from './src/navigation/root/RootNavigator';
import { initQueueNetworkListener, initializeQueue, processQueue } from './src/core/services/queueEngine';
import { getErrorMessage } from './src/core/utils/errorMessage';
import { showErrorToast } from './src/core/utils/toast';

const App = () => {
    useEffect(() => {
        const unsubscribeNet = initQueueNetworkListener();
        const appStateSubscription = AppState.addEventListener('change', state => {
            if (state === 'active') {
                processQueue().catch(error => {
                    showErrorToast('Could not resume saved reports', getErrorMessage(error));
                });
            }
        });

        initializeQueue().catch(error => {
            showErrorToast('Could not restore saved reports', getErrorMessage(error));
        });

        return () => {
            unsubscribeNet();
            appStateSubscription.remove();
        };
    }, []);

    return (
        <Provider store={store}>
            <SafeAreaProvider>
                <StatusBar barStyle="dark-content" />
                <RootNavigator />
                <Toast />
            </SafeAreaProvider>
        </Provider>
    );
};

export default App;
