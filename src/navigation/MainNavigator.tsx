import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { PlaylistScreen } from '../screens/PlaylistScreen';
import { PlayerScreen } from '../screens/PlayerScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { MiniPlayer } from '../components/MiniPlayer';
import { SyncPromptModal } from '../components/SyncPromptModal';
import { getActiveUser } from '../utils/storage';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

function LibraryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, presentation: 'card' }}>
      <Stack.Screen name="LibraryHome" component={LibraryScreen} />
      <Stack.Screen name="PlaylistDetail" component={PlaylistScreen} />
    </Stack.Navigator>
  );
}

function TabNavigator() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: {
            backgroundColor: '#000000',
            shadowColor: 'transparent',
            elevation: 0,
          },
          headerTintColor: '#ffffff',
          tabBarStyle: {
            backgroundColor: '#121212',
            borderTopWidth: 0,
          },
          tabBarActiveTintColor: '#ffffff',
          tabBarInactiveTintColor: '#888888',
          tabBarIcon: ({ color, size }) => {
            let iconName: any = 'home';
            if (route.name === 'Home') iconName = 'home';
            else if (route.name === 'Search') iconName = 'search';
            else if (route.name === 'Library') iconName = 'library';
            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Library" component={LibraryStack} />
      </Tab.Navigator>
      <MiniPlayer />
    </View>
  );
}

const appTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#000000',
    card: '#121212',
    text: '#ffffff',
    border: '#222222',
    primary: '#ffffff',
  },
};

export function MainNavigator() {
  const hasSession = !!getActiveUser();

  return (
    <NavigationContainer theme={appTheme}>
      <RootStack.Navigator 
        initialRouteName={hasSession ? 'MainTabs' : 'Auth'}
        screenOptions={{ headerShown: false, presentation: 'fullScreenModal' }}
      >
        <RootStack.Screen name="Auth" component={AuthScreen} />
        <RootStack.Screen name="Setup" component={AuthScreen} />
        <RootStack.Screen name="MainTabs" component={TabNavigator} />
        <RootStack.Screen name="Player" component={PlayerScreen} />
      </RootStack.Navigator>
      {hasSession && <SyncPromptModal />}
    </NavigationContainer>
  );
}
