/**
 * Clinic Room Module: room types and operational statuses.
 * Align with schema and display formatters (human-readable labels).
 */

export const ROOM_TYPES = [
  "CONSULTATION",
  "SURGERY",
  "LAB",
  "IMAGING",
  "PROCEDURE",
  "VACCINATION",
  "GROOMING",
  "ISOLATION",
  "RECOVERY",
  "MULTIPURPOSE",
  "GENERAL",
  "OTHER",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

/** Room types allowed for vial activation (injection room only). */
export const INJECTION_ROOM_TYPES: RoomType[] = ["VACCINATION", "PROCEDURE", "MULTIPURPOSE", "GENERAL"];

/** Lifecycle status (ACTIVE / INACTIVE) - stored in BranchRoom.status */
export const ROOM_LIFECYCLE_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type RoomLifecycleStatus = (typeof ROOM_LIFECYCLE_STATUSES)[number];

/** Operational status - stored in BranchRoom.operationalStatus */
export const ROOM_OPERATIONAL_STATUSES = [
  "AVAILABLE",
  "RESERVED",
  "OCCUPIED",
  "CLEANING",
  "MAINTENANCE",
  "BLOCKED",
] as const;

export type RoomOperationalStatus = (typeof ROOM_OPERATIONAL_STATUSES)[number];

/** Block type for ClinicRoomBlock */
export const ROOM_BLOCK_TYPES = [
  "CLEANING",
  "MAINTENANCE",
  "BLOCKED",
  "EMERGENCY_UNAVAILABLE",
] as const;

export type RoomBlockType = (typeof ROOM_BLOCK_TYPES)[number];

/** Human-readable labels for room type (for audit and UI) */
export const ROOM_TYPE_LABELS: Record<string, string> = {
  CONSULTATION: "Consultation",
  SURGERY: "Surgery",
  LAB: "Lab",
  IMAGING: "Imaging",
  PROCEDURE: "Procedure",
  VACCINATION: "Vaccination",
  GROOMING: "Grooming",
  ISOLATION: "Isolation",
  RECOVERY: "Recovery",
  MULTIPURPOSE: "Multipurpose",
  GENERAL: "General",
  OTHER: "Other",
};

/** Human-readable labels for operational status */
export const ROOM_OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  OCCUPIED: "Occupied",
  CLEANING: "Cleaning",
  MAINTENANCE: "Maintenance",
  BLOCKED: "Blocked",
};

/** Human-readable labels for block type */
export const ROOM_BLOCK_TYPE_LABELS: Record<string, string> = {
  CLEANING: "Cleaning",
  MAINTENANCE: "Maintenance",
  BLOCKED: "Blocked",
  EMERGENCY_UNAVAILABLE: "Emergency unavailable",
};

export function getRoomTypeLabel(value: string): string {
  return ROOM_TYPE_LABELS[value] ?? value;
}

export function getRoomOperationalStatusLabel(value: string): string {
  return ROOM_OPERATIONAL_STATUS_LABELS[value] ?? value;
}

export function getRoomBlockTypeLabel(value: string): string {
  return ROOM_BLOCK_TYPE_LABELS[value] ?? value;
}
