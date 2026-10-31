import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { store } from './src/store/store';
import RootNavigator from './src/navigation/root/RootNavigator';
import { initQueueNetworkListener, processQueue } from './src/core/services/queueEngine';

const App = () => {

    useEffect(() => {
        // 1. Listen for network reconnection
        const unsubscribeNet = initQueueNetworkListener();

        // 2. Hydrate & process disk queue on app start (handles recovering from force-quit)
        processQueue();

        return () => {
            unsubscribeNet();
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
