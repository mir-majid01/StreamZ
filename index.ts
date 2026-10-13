import { mark } from '@/src/utils/startupTiming';
import { registerRootComponent } from 'expo';
import { Appearance } from 'react-native';

import App from './App';

mark('bundle-evaluated');

// StreamZ is dark-only. Pin the scheme here, at module evaluation, before the
// root component is registered — so useColorScheme()/Appearance report 'dark'
// on the very first frame instead of only after GluestackUIProvider's
// useEffect runs (which is after the first commit, i.e. too late).
Appearance.setColorScheme('dark');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
