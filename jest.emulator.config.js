// Rules and Functions tests are plain Node code. Using the jest-expo preset forces the
// React Native/browser field resolution, which pulls @firebase's ESM chain into a
// CommonJS runtime. Run them in a bare Node environment instead.
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  // Connecting to the emulator and compiling the rules is slow on a small machine; the
  // 5 s default fails the beforeAll hook before a single assertion has run.
  testTimeout: 30000,
  testMatch: [
    '<rootDir>/__tests__/rules/**/*.test.ts',
    '<rootDir>/__tests__/functions/**/*.test.ts',
  ],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
