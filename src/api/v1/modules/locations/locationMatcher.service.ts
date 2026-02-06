/**
 * Location Matcher Service
 * 
 * Matches coordinates to BD_AREA or DHAKA_AREA locations
 * Uses simple distance calculation or bounding box matching
 */

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface LocationMatch {
  kind: 'BD_AREA' | 'DHAKA_AREA';
  bdAreaId?: number;
  dhakaAreaId?: number;
  cityCorporationId?: number;
  cityCorporationCode?: string;
  divisionId?: number;
  districtId?: number;
  upazilaId?: number;
  nameEn?: string;
  nameBn?: string;
  fullPathText?: string;
  confidence: number; // 0-1
  distance?: number; // in kilometers
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Match coordinates to nearest BD_AREA or DHAKA_AREA
 * 
 * @param prisma Prisma client instance
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @param maxDistance Maximum distance in kilometers (default: 10km)
 * @returns Matched location or null
 */
export async function matchCoordinatesToLocation(
  prisma: any,
  latitude: number,
  longitude: number,
  maxDistance: number = 10
): Promise<LocationMatch | null> {
  try {
    let bestMatch: LocationMatch | null = null;
    let bestDistance = Infinity;

    // First, try to find nearest BD areas with coordinates
    const bdAreasWithCoords = await prisma.bdArea.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        latitude: true,
        longitude: true,
        upazilaId: true,
        districtId: true,
        type: true,
      },
      take: 100, // Limit to avoid too many calculations
    });

    for (const bdArea of bdAreasWithCoords) {
      if (bdArea.latitude && bdArea.longitude) {
        const distance = calculateDistance(
          latitude,
          longitude,
          Number(bdArea.latitude),
          Number(bdArea.longitude)
        );

        if (distance < bestDistance && distance <= maxDistance) {
          // Load hierarchy for full path
          const upazila = bdArea.upazilaId
            ? await prisma.bdUpazila.findUnique({
                where: { id: bdArea.upazilaId },
                select: {
                  id: true,
                  nameEn: true,
                  nameBn: true,
                  district: {
                    select: {
                      id: true,
                      nameEn: true,
                      nameBn: true,
                      division: {
                        select: {
                          id: true,
                          nameEn: true,
                          nameBn: true,
                        },
                      },
                    },
                  },
                },
              })
            : null;

          const parts = [];
          if (upazila?.district?.division) parts.push(upazila.district.division.nameEn || upazila.district.division.nameBn);
          if (upazila?.district) parts.push(upazila.district.nameEn || upazila.district.nameBn);
          if (upazila) parts.push(upazila.nameEn || upazila.nameBn);
          parts.push(bdArea.nameEn || bdArea.nameBn);

          bestMatch = {
            kind: 'BD_AREA',
            bdAreaId: bdArea.id,
            divisionId: upazila?.district?.division?.id,
            districtId: upazila?.district?.id || bdArea.districtId,
            upazilaId: bdArea.upazilaId,
            nameEn: bdArea.nameEn,
            nameBn: bdArea.nameBn,
            fullPathText: parts.filter(Boolean).join(' > '),
            confidence: distance < 1 ? 0.9 : distance < 5 ? 0.7 : 0.5,
            distance,
          };
          bestDistance = distance;
        }
      }
    }

    // Try Dhaka areas with coordinates
    const dhakaAreasWithCoords = await prisma.area.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        latitude: true,
        longitude: true,
        cityCorporationId: true,
      },
      take: 100,
    });

    for (const dhakaArea of dhakaAreasWithCoords) {
      if (dhakaArea.latitude && dhakaArea.longitude) {
        const distance = calculateDistance(
          latitude,
          longitude,
          Number(dhakaArea.latitude),
          Number(dhakaArea.longitude)
        );

        if (distance < bestDistance && distance <= maxDistance) {
          const corp = await prisma.cityCorporation.findUnique({
            where: { id: dhakaArea.cityCorporationId },
            select: { code: true, nameEn: true, nameBn: true },
          });

          const parts = [];
          if (corp) parts.push(corp.nameEn || corp.nameBn || corp.code);
          parts.push(dhakaArea.nameEn || dhakaArea.nameBn);

          bestMatch = {
            kind: 'DHAKA_AREA',
            dhakaAreaId: dhakaArea.id,
            cityCorporationId: dhakaArea.cityCorporationId,
            cityCorporationCode: corp?.code || null,
            nameEn: dhakaArea.nameEn,
            nameBn: dhakaArea.nameBn,
            fullPathText: parts.filter(Boolean).join(' > '),
            confidence: distance < 1 ? 0.9 : distance < 5 ? 0.7 : 0.5,
            distance,
          };
          bestDistance = distance;
        }
      }
    }

    // If we found a good match, return it
    if (bestMatch && bestDistance <= maxDistance) {
      return bestMatch;
    }

    // If no area match, try to find nearest upazila/district center as fallback
    const upazilasWithCoords = await prisma.bdUpazila.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        latitude: true,
        longitude: true,
        district: {
          select: {
            id: true,
            nameEn: true,
            nameBn: true,
            division: {
              select: {
                id: true,
                nameEn: true,
                nameBn: true,
              },
            },
          },
        },
      },
      take: 50,
    });

    for (const upazila of upazilasWithCoords) {
      if (upazila.latitude && upazila.longitude) {
        const distance = calculateDistance(
          latitude,
          longitude,
          Number(upazila.latitude),
          Number(upazila.longitude)
        );

        if (distance < bestDistance && distance <= maxDistance * 2) {
          const parts = [];
          if (upazila.district?.division) parts.push(upazila.district.division.nameEn || upazila.district.division.nameBn);
          if (upazila.district) parts.push(upazila.district.nameEn || upazila.district.nameBn);
          parts.push(upazila.nameEn || upazila.nameBn);

          bestMatch = {
            kind: 'BD_AREA',
            divisionId: upazila.district?.division?.id,
            districtId: upazila.district?.id,
            upazilaId: upazila.id,
            nameEn: upazila.nameEn,
            nameBn: upazila.nameBn,
            fullPathText: parts.filter(Boolean).join(' > '),
            confidence: distance < 5 ? 0.6 : distance < 10 ? 0.4 : 0.2,
            distance,
          };
          bestDistance = distance;
        }
      }
    }

    return bestMatch;
  } catch (error) {
    console.error('Location matching error:', error);
    return null;
  }
}

// CommonJS export for compatibility
module.exports = {
  matchCoordinatesToLocation,
};

export {};
