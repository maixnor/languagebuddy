module.exports = {
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {},
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@langchain/core|@langchain/openai|p-retry|is-network-error)/)',
  ],
  testEnvironment: 'node',
  testMatch: [
    '**/src/**/*.unit.test.ts',
    '**/src/**/*.int.test.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.e2e.test.ts$',
    '/src/features/subscriber/subscriber.prompts.unit.test.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 30000, // 30 seconds for unit and integration tests
  forceExit: true,
  detectOpenHandles: true,
  setupFiles: ["dotenv/config"],
};