// Rules and Functions tests are plain Node code. Using the jest-expo preset forces the
// React Native/browser field resolution, which pulls @firebase's ESM chain into a
// CommonJS runtime. Run them in a bare Node environment instead.
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/rules/**/*.test.ts',
    '<rootDir>/__tests__/functions/**/*.test.ts',
  ],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
