export const LOCATION_PERMISSIONS = {
  READ: "location.master.read",
  MANAGE: "location.master.manage",
  COVERAGE_READ: "location.coverage.read",
  COVERAGE_MANAGE: "location.coverage.manage",
  MIGRATE: "location.migration.manage",
} as const;

export type LocationPermissionKey =
  (typeof LOCATION_PERMISSIONS)[keyof typeof LOCATION_PERMISSIONS];

module.exports = {
  LOCATION_PERMISSIONS,
};
