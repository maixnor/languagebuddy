module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 60000, // 60 seconds timeout for e2e tests
  forceExit: true, // Force Jest to exit after tests complete
  detectOpenHandles: true, // Help detect what's keeping the process open
};
