module.exports = {
  rootDir: '.',

  testEnvironment: 'node',

  transform: {
    '^.+\\.(t|j)s$': '@swc/jest',
  },

  transformIgnorePatterns: [
    'node_modules/(?!(?:@nestjs)/)',
  ],

  moduleFileExtensions: ['ts', 'js', 'json'],

  // Solo pruebas unitarias; las E2E usan test/jest-e2e.json
  testMatch: ['<rootDir>/src/**/*.spec.ts'],

  clearMocks: true,

  collectCoverageFrom: [
    'src/**/*.(t|j)s',
  ],

  coverageDirectory: './coverage',
};