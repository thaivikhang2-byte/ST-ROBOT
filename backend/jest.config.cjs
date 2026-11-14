module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/prisma/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: { ...require('./tsconfig.json').compilerOptions, allowJs: true },
    }],
  },
  // The patched sanitizer uses ESM parsing dependencies. Execute their real
  // code under Jest's CommonJS runtime; do not replace HTML validation in tests.
  transformIgnorePatterns: ['/node_modules/(?!(htmlparser2|entities|domhandler|domutils|domelementtype|dom-serializer)/)'],
  moduleNameMapper: { '^@sdk/(.*)$': '<rootDir>/src/shared/sdk/$1' },
  clearMocks: true,
};
