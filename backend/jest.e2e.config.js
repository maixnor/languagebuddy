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
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 120000, // 120 seconds for e2e tests (real API calls)
  forceExit: true,
  detectOpenHandles: true,
};
