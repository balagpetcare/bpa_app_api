/**
 * Vaccination Demand Forecasting & Rollout Planning — API types.
 */

export type DemandPriority = "low" | "medium" | "high" | "critical";

export type ForecastConfidence = "low" | "medium" | "high";

export interface DemandIntelligenceCampaignContext {
  id: number;
  name: string;
  pricingType: string;
  pricePerCat: number;
  currency: string;
  targetVaccinations: number;
  startDate: string;
  endDate: string;
}

export interface ExecutiveSummary {
  totalPreRegistrations: number;
  totalPreRegCats: number;
  totalBookings: number;
  totalBookingCats: number;
  totalVaccinated: number;
  conversionRate: number;
  currentDemandCats: number;
  projectedDemand: number;
  projectedRevenue: number;
  horizonDays: number;
  weeklyVelocityCats: number;
  forecast: {
    horizonDays: number;
    currentDemandCats: number;
    vaccinatedToDate: number;
    weeklyPreRegCats: number;
    weeklyBookingCats: number;
    projectedNewDemandCats: number;
    projectedTotalDemandCats: number;
    projectedVaccinations: number;
    confidence: ForecastConfidence;
  };
}

export interface GeoRankRow {
  rank: number;
  demandScore: number;
  preRegistrations: number;
  preRegCats: number;
  bookingCount: number;
  bookingCats: number;
  totalCats: number;
  totalSignals: number;
}

export interface DivisionRankingRow extends GeoRankRow {
  divisionId: number;
  divisionName: string;
}

export interface DistrictRankingRow extends GeoRankRow {
  districtId: number;
  districtName: string;
  divisionId: number | null;
  divisionName: string | null;
}

export interface UpazilaRankingRow extends GeoRankRow {
  upazilaId: number;
  upazilaName: string;
  districtId: number | null;
  districtName: string | null;
}

export interface LocationRankingRow extends GeoRankRow {
  locationId: number;
  locationName: string;
  dailyCapacity: number;
  slotCapacity: number;
  slotBooked: number;
  utilizationPercent: number;
  isActive: boolean;
}

export interface HeatmapPoint {
  level: "division" | "district" | "upazila" | "area";
  id: number;
  name: string;
  districtName?: string | null;
  divisionName?: string | null;
  latitude: number | null;
  longitude: number | null;
  demandScore: number;
  totalCats: number;
  preRegCats?: number;
  bookingCats?: number;
}

export interface GeographicIntelligence {
  divisionRanking: DivisionRankingRow[];
  districtRanking: DistrictRankingRow[];
  upazilaRanking: UpazilaRankingRow[];
  locationRanking: LocationRankingRow[];
  topAreas: Array<{
    rank: number;
    areaName: string;
    districtName: string | null;
    upazilaName: string | null;
    totalCats: number;
    demandScore: number;
  }>;
  heatmap: {
    division: HeatmapPoint[];
    district: HeatmapPoint[];
    upazila: HeatmapPoint[];
    area: HeatmapPoint[];
  };
}

export interface VaccineDemandLine {
  vaccineId: number;
  name: string;
  dosesPerCat: number;
  projectedDoses: number;
  bufferDoses: number;
  totalRequired: number;
  allocatedDoses: number | null;
  usedDoses: number;
  availableInventory: number | null;
  shortage: number;
  hasShortage: boolean;
}

export interface VaccineForecasting {
  vaccinesPerCat: number;
  requiredQuantity: number;
  bufferPercent: number;
  bufferQuantity: number;
  totalWithBuffer: number;
  availableInventory: number;
  netShortage: number;
  hasShortageWarning: boolean;
  byVaccine: VaccineDemandLine[];
}

export interface ResourcePlanning {
  recommendedDoctors: number;
  recommendedVolunteers: number;
  recommendedCoordinators: number;
  currentStaff: { vaccinators: number; support: number; coordinators: number; total: number };
  requiredSlots: number;
  existingSlots: number;
  openSlotCapacity: number;
  estimatedWorkingDays: number;
  catsPerDayCapacity: number;
  dailyCapacityAnalysis: Array<{
    date: string;
    slotCount: number;
    totalCapacity: number;
    booked: number;
    utilizationPercent: number;
  }>;
  capacityByDistrict: Array<{
    districtId: number;
    districtName: string;
    totalDemandCats: number;
    currentCapacity: number;
    recommendedCapacity: number;
    capacityGap: number;
    priority: DemandPriority;
    hasActiveRegion: boolean;
  }>;
}

export interface AiRecommendation {
  id: string;
  category: "rollout" | "capacity" | "procurement" | "staffing";
  priority: DemandPriority;
  title: string;
  detail: string;
  actionHint?: string;
}

export interface DemandCharts {
  demandTrend: Array<{
    date: string;
    preRegistrations: number;
    preRegCats: number;
    bookings: number;
    bookingCats: number;
    vaccinations: number;
  }>;
  districtComparison: Array<{ name: string; totalCats: number; demandScore: number }>;
  vaccineDemand: Array<{ name: string; totalRequired: number; available: number }>;
  capacityUtilization: Array<{ date: string; capacity: number; booked: number; utilization: number }>;
}

/** Full enterprise report + legacy fields for existing clients. */
export interface DemandIntelligenceReport {
  campaign: DemandIntelligenceCampaignContext;
  generatedAt: string;
  executiveSummary: ExecutiveSummary;
  geographic: GeographicIntelligence;
  vaccineForecast: VaccineForecasting;
  resourcePlanning: ResourcePlanning;
  recommendations: AiRecommendation[];
  charts: DemandCharts;
  /** @deprecated Use executiveSummary — kept for backward compatibility */
  summary: {
    topRequestedAreas: GeographicIntelligence["topAreas"];
    topRequestedDistricts: Array<{ rank: number; districtName: string; totalCats: number; demandScore: number }>;
    projectedVaccineDemand: number;
    projectedRevenue: number;
    totalPreRegistrations: number;
    totalBookings: number;
    currentDemandCats: number;
  };
  /** Legacy alias: `city` mirrors `geographic.heatmap.upazila`. */
  heatmap: GeographicIntelligence["heatmap"] & { city: HeatmapPoint[] };
  districtRanking: DistrictRankingRow[];
  vaccinationForecast: ExecutiveSummary["forecast"];
  capacityRecommendations: ResourcePlanning["capacityByDistrict"];
  tracking: {
    districtDemand: DistrictRankingRow[];
    cityDemand: UpazilaRankingRow[];
    areaDemand: GeographicIntelligence["topAreas"];
  };
}
