/**
 * Flow / supply-chain tests only — single worker + smaller discovery set to avoid OOM
 * when loading Prisma-heavy modules alongside the main src/** test suite.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/flow"],
  testMatch: ["**/*.test.ts", "**/*.e2e.test.ts"],
  maxWorkers: 1,
  moduleFileExtensions: ["ts", "js", "json"],
  verbose: true,
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        diagnostics: false,
        tsconfig: {
          types: ["node", "jest"],
          esModuleInterop: true,
          module: "commonjs",
        },
      },
    ],
  },
};
