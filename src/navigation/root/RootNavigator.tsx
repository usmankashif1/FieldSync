import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StackNavigator from '../main/Stack/StackNavigator';

export type RootStackParamList = {
    Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator = () => {
    return (
        <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Main" component={StackNavigator} />
            </Stack.Navigator>
        </NavigationContainer>
    );
};

export default RootNavigator;
