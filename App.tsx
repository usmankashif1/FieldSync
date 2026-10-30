import React from 'react';
import { StatusBar } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { store } from './src/store/store';
import RootNavigator from './src/navigation/root/RootNavigator';

const App = () => {
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
