const shared = require('./jest.config.shared.js');

// Unit tests only. Emulator-backed suites live in jest.emulator.config.js, because
// testPathIgnorePatterns built from escaped backslashes over-matches on Windows.
module.exports = { ...shared, testMatch: ['<rootDir>/__tests__/*.test.ts'] };
