/**
 * Resolve customer-facing booking location labels for admin/list/export APIs.
 * Zone-interest (Dhaka corporation + area) bookings have no CampaignLocation row.
 */

const CITY_CORPORATION_NAMES: Record<string, string> = {
  DNCC: "Dhaka North City Corporation",
  DSCC: "Dhaka South City Corporation",
};

export type BookingLocationFields = {
  cityCorporation?: string;
  cityCorporationCode?: string;
  area?: string;
  locationLabel: string;
};

export type BookingLocationDisplay = {
  id?: number;
  name?: string;
  address?: string;
  cityCorporation?: string;
  cityCorporationCode?: string;
  area?: string;
};

function parseAddressJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function resolveCityCorporationName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  return CITY_CORPORATION_NAMES[normalized] ?? undefined;
}

export function resolveBookingLocationDisplay(booking: {
  bookingMode?: string | null;
  location?: { id: number; name: string; address?: string | null } | null;
  bookingArea?: string | null;
  coverageZoneName?: string | null;
  ownerAddressJson?: unknown;
}): BookingLocationDisplay | null {
  const address = parseAddressJson(booking.ownerAddressJson);
  const cityCode =
    typeof address?.cityCorporationCode === "string"
      ? address.cityCorporationCode.trim().toUpperCase()
      : undefined;
  const cityCorporation =
    (typeof address?.cityCorporationName === "string"
      ? address.cityCorporationName.trim()
      : undefined) || resolveCityCorporationName(cityCode);

  const areaFromJson =
    typeof address?.bookingArea === "string" && address.bookingArea.trim()
      ? address.bookingArea.trim()
      : undefined;
  const area =
    booking.bookingArea?.trim() ||
    areaFromJson ||
    booking.coverageZoneName?.trim() ||
    undefined;

  if (booking.location?.name) {
    return {
      id: booking.location.id,
      name: booking.location.name,
      address: booking.location.address ?? undefined,
      cityCorporation,
      cityCorporationCode: cityCode,
      area: area && area !== booking.location.name ? area : undefined,
    };
  }

  if (cityCorporation || area) {
    return {
      cityCorporation,
      cityCorporationCode: cityCode,
      area,
    };
  }

  return null;
}

/** Short label for admin tables: `DSCC → Rampura / Banasree`. */
export function formatBookingLocationShortLabel(display: BookingLocationDisplay | null): string {
  if (!display) return "";

  if (display.name && !display.cityCorporationCode && !display.cityCorporation && !display.area) {
    return display.name;
  }

  const corpToken = display.cityCorporationCode || display.cityCorporation;
  if (corpToken && display.area) {
    return `${corpToken} → ${display.area}`;
  }

  if (display.area) return display.area;
  if (display.name) return display.name;
  if (corpToken) return corpToken;
  return "";
}

/** Full label: `Dhaka South City Corporation → Rampura / Banasree`. */
export function formatBookingLocationLabel(display: BookingLocationDisplay | null): string {
  if (!display) return "";

  if (display.name && !display.cityCorporation && !display.area) {
    return display.name;
  }

  if (display.cityCorporation && display.area) {
    return `${display.cityCorporation} → ${display.area}`;
  }

  if (display.area) return display.area;
  if (display.name) return display.name;
  if (display.cityCorporation) return display.cityCorporation;
  return "";
}

/** Resolved API fields for list/detail responses. */
export function resolveBookingLocationFields(booking: {
  bookingMode?: string | null;
  location?: { id: number; name: string; address?: string | null } | null;
  bookingArea?: string | null;
  coverageZoneName?: string | null;
  ownerAddressJson?: unknown;
}): BookingLocationFields | null {
  const display = resolveBookingLocationDisplay(booking);
  if (!display) return null;

  const shortLabel = formatBookingLocationShortLabel(display);
  const longLabel = formatBookingLocationLabel(display);
  const locationLabel = shortLabel || longLabel;
  if (!locationLabel) return null;

  return {
    cityCorporation: display.cityCorporation,
    cityCorporationCode: display.cityCorporationCode,
    area: display.area,
    locationLabel,
  };
}
