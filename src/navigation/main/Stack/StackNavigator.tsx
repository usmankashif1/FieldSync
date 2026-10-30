import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeNavigator from '../../../screens/home/navigation/HomeNavigator';

export type MainStackParamList = {
    Tabs: undefined;
    HomeNavigator: undefined;
    // Add full-screen (non-tab) screens here, e.g. Details: { id: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

const StackNavigator = () => {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="HomeNavigator" component={HomeNavigator} />
        </Stack.Navigator>
    );
};

export default StackNavigator;
