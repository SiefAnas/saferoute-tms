/**
 * Tests here cover the pure logic the app depends on (local calendar dates, the API client's
 * error/401 handling, role routing). They run in plain Node with babel-preset-expo for the
 * TypeScript, so no React Native runtime or native module mocking is needed — the modules
 * under test take their platform pieces (token storage, fetch) as injected dependencies.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\.[jt]sx?$': 'babel-jest' },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
}
