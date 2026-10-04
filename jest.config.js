module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  // Emulator-backed suites run under `npm run test:emulator`, never bare `npm test`.
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/rules/', '/__tests__/functions/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|expo-.*|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@notifee/react-native|@react-native-firebase/.*|nativewind|react-native-css)/)',
  ],
};
