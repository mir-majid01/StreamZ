// Windows paths contain backslashes, so a pattern using only "/" never matches and
// every dependency ends up untransformed. [/\\] covers both separators.
const IGNORE =
  'node_modules[/\\\\](?!((jest-)?react-native|@react-native(-community)?|@react-native-firebase[/\\\\].*|firebase[/\\\\].*|@firebase[/\\\\].*|expo(nent)?|expo-.*|@expo(nent)?[/\\\\].*|@expo-google-fonts[/\\\\].*|react-navigation|@react-navigation[/\\\\].*|@notifee[/\\\\].*|nativewind|react-native-css))';

module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transformIgnorePatterns: [IGNORE],
};
