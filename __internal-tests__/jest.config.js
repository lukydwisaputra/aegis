/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  moduleNameMapper: {
    '^@qa/(.*)$': '<rootDir>/../packages/@qa/$1/src/index',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        ignoreDeprecations: '5.0',
        baseUrl: '.',
        paths: { '@qa/*': ['../packages/@qa/*/src/index'] },
        types: ['jest', 'node'],
      },
      diagnostics: {
        // import.meta.url in source compiled as CJS, globby dynamic import type
        ignoreCodes: [1343, 2307],
      },
    }],
  },
};

module.exports = config;
