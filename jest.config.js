/** Jest config for product-import unit tests; does not affect production tsc. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "branchRoleMatrix\\.test\\.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/api/v1/services/product-import/**/*.ts", "!**/*.test.ts"],
  coverageDirectory: "coverage",
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
