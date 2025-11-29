module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/tests/unit/**/*.test.ts',
    '**/tests/int/**/*.test.ts',
    '**/src/**/*.test.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/'
  ],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 30000, // 30 seconds for unit and integration tests
  forceExit: true,
  detectOpenHandles: true,
  setupFiles: ["dotenv/config"],
};
