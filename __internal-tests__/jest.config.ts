import type { Config } from 'jest';
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  moduleNameMapper: {
    '^@qa/(.*)$': '<rootDir>/../packages/@qa/$1/src/index'
  }
};
export default config;
