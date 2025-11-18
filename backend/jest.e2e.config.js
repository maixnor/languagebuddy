module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 120000, // 120 seconds for e2e tests (real API calls)
  forceExit: true,
  detectOpenHandles: true,
};
