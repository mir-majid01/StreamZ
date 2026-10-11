import { useEffect } from 'react';
import {
  BottomTabBar,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { PartySessionBar } from '@/src/components/party/PartySessionBar';
import {
  Download as DownloadIcon,
  Home as HomeIcon,
  Radio as LiveIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { HomeScreen } from '@/src/screens/HomeScreen';
import { SearchScreen } from '@/src/screens/SearchScreen';
import { SettingsScreen } from '@/src/screens/SettingsScreen';
import { DownloadsScreen } from '@/src/screens/DownloadsScreen';
import { LiveTvScreen } from '@/src/screens/LiveTvScreen';
import { LIVE_TV_CONFIG } from '@/src/config/env';
import { BACKGROUND, BORDER_COLOR, BRAND_COLOR, TEXT_COLOR } from '@/src/theme/tokens';
import { mark } from '@/src/utils/startupTiming';

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Live: undefined;
  Downloads: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export const TabNavigator = () => {
  useEffect(() => {
    mark('main-mounted');
  }, []);

  return (
    <Tab.Navigator
      tabBar={(props) => (
        <>
          <PartySessionBar placement="tabs" />
          <BottomTabBar {...props} />
        </>
      )}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BRAND_COLOR.primary,
        tabBarInactiveTintColor: TEXT_COLOR.tertiary,
        tabBarStyle: {
          backgroundColor: BACKGROUND.raised,
          borderTopColor: BORDER_COLOR.subtle,
          borderTopWidth: 1,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <SearchIcon color={color} size={size} />
          ),
        }}
      />
      {LIVE_TV_CONFIG.enabled ? (
        <Tab.Screen
          name="Live"
          component={LiveTvScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <LiveIcon color={color} size={size} />
            ),
          }}
        />
      ) : null}
      <Tab.Screen
        name="Downloads"
        component={DownloadsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <DownloadIcon color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <SettingsIcon color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};
