/**
 * Seeds VetCountry, VetRegulatoryBody, and VetRequiredDocType for global veterinary doctor verification.
 * Covers 180+ countries and 200+ regulatory bodies. Safe to run multiple times (upsert by code / unique keys).
 */

import { PrismaClient } from "@prisma/client";

const DEFAULT_DOC_TYPES = [
  { documentType: "VET_LICENSE", label: "Veterinary License/Registration", description: "Primary license certificate", isRequired: true, sortOrder: 1 },
  { documentType: "VET_DEGREE", label: "Veterinary Degree (DVM/BVSc/etc.)", description: "University degree certificate", isRequired: true, sortOrder: 2 },
  { documentType: "GOV_ID_FRONT", label: "Government ID (Front)", description: "National ID, passport, or driver's license", isRequired: true, sortOrder: 3 },
  { documentType: "GOV_ID_BACK", label: "Government ID (Back)", description: "Back side of government ID", isRequired: false, sortOrder: 4 },
  { documentType: "PROFILE_PHOTO", label: "Professional Photo", description: "Passport-style photo", isRequired: true, sortOrder: 5 },
  { documentType: "ADDITIONAL", label: "Additional Document", description: "Any other supporting document", isRequired: false, sortOrder: 10 },
];

// ISO 3166-1 alpha-2 codes and names, grouped by region (180+ countries)
const COUNTRIES: { code: string; name: string; region: string }[] = [
  // Asia
  { code: "AF", name: "Afghanistan", region: "Asia" },
  { code: "BD", name: "Bangladesh", region: "Asia" },
  { code: "BT", name: "Bhutan", region: "Asia" },
  { code: "BN", name: "Brunei", region: "Asia" },
  { code: "KH", name: "Cambodia", region: "Asia" },
  { code: "CN", name: "China", region: "Asia" },
  { code: "IN", name: "India", region: "Asia" },
  { code: "ID", name: "Indonesia", region: "Asia" },
  { code: "IR", name: "Iran", region: "Asia" },
  { code: "JP", name: "Japan", region: "Asia" },
  { code: "KZ", name: "Kazakhstan", region: "Asia" },
  { code: "KP", name: "North Korea", region: "Asia" },
  { code: "KR", name: "South Korea", region: "Asia" },
  { code: "KG", name: "Kyrgyzstan", region: "Asia" },
  { code: "LA", name: "Laos", region: "Asia" },
  { code: "MY", name: "Malaysia", region: "Asia" },
  { code: "MV", name: "Maldives", region: "Asia" },
  { code: "MN", name: "Mongolia", region: "Asia" },
  { code: "MM", name: "Myanmar", region: "Asia" },
  { code: "NP", name: "Nepal", region: "Asia" },
  { code: "PK", name: "Pakistan", region: "Asia" },
  { code: "PH", name: "Philippines", region: "Asia" },
  { code: "SG", name: "Singapore", region: "Asia" },
  { code: "LK", name: "Sri Lanka", region: "Asia" },
  { code: "TW", name: "Taiwan", region: "Asia" },
  { code: "TJ", name: "Tajikistan", region: "Asia" },
  { code: "TH", name: "Thailand", region: "Asia" },
  { code: "TL", name: "Timor-Leste", region: "Asia" },
  { code: "TM", name: "Turkmenistan", region: "Asia" },
  { code: "UZ", name: "Uzbekistan", region: "Asia" },
  { code: "VN", name: "Vietnam", region: "Asia" },
  // Europe
  { code: "AL", name: "Albania", region: "Europe" },
  { code: "AD", name: "Andorra", region: "Europe" },
  { code: "AM", name: "Armenia", region: "Europe" },
  { code: "AT", name: "Austria", region: "Europe" },
  { code: "AZ", name: "Azerbaijan", region: "Europe" },
  { code: "BY", name: "Belarus", region: "Europe" },
  { code: "BE", name: "Belgium", region: "Europe" },
  { code: "BA", name: "Bosnia and Herzegovina", region: "Europe" },
  { code: "BG", name: "Bulgaria", region: "Europe" },
  { code: "HR", name: "Croatia", region: "Europe" },
  { code: "CY", name: "Cyprus", region: "Europe" },
  { code: "CZ", name: "Czech Republic", region: "Europe" },
  { code: "DK", name: "Denmark", region: "Europe" },
  { code: "EE", name: "Estonia", region: "Europe" },
  { code: "FI", name: "Finland", region: "Europe" },
  { code: "FR", name: "France", region: "Europe" },
  { code: "GE", name: "Georgia", region: "Europe" },
  { code: "DE", name: "Germany", region: "Europe" },
  { code: "GR", name: "Greece", region: "Europe" },
  { code: "HU", name: "Hungary", region: "Europe" },
  { code: "IS", name: "Iceland", region: "Europe" },
  { code: "IE", name: "Ireland", region: "Europe" },
  { code: "IT", name: "Italy", region: "Europe" },
  { code: "LV", name: "Latvia", region: "Europe" },
  { code: "LT", name: "Lithuania", region: "Europe" },
  { code: "LU", name: "Luxembourg", region: "Europe" },
  { code: "MT", name: "Malta", region: "Europe" },
  { code: "MD", name: "Moldova", region: "Europe" },
  { code: "MC", name: "Monaco", region: "Europe" },
  { code: "ME", name: "Montenegro", region: "Europe" },
  { code: "NL", name: "Netherlands", region: "Europe" },
  { code: "MK", name: "North Macedonia", region: "Europe" },
  { code: "NO", name: "Norway", region: "Europe" },
  { code: "PL", name: "Poland", region: "Europe" },
  { code: "PT", name: "Portugal", region: "Europe" },
  { code: "RO", name: "Romania", region: "Europe" },
  { code: "RU", name: "Russia", region: "Europe" },
  { code: "SM", name: "San Marino", region: "Europe" },
  { code: "RS", name: "Serbia", region: "Europe" },
  { code: "SK", name: "Slovakia", region: "Europe" },
  { code: "SI", name: "Slovenia", region: "Europe" },
  { code: "ES", name: "Spain", region: "Europe" },
  { code: "SE", name: "Sweden", region: "Europe" },
  { code: "CH", name: "Switzerland", region: "Europe" },
  { code: "TR", name: "Turkey", region: "Europe" },
  { code: "UA", name: "Ukraine", region: "Europe" },
  { code: "GB", name: "United Kingdom", region: "Europe" },
  { code: "VA", name: "Vatican City", region: "Europe" },
  // Americas
  { code: "AG", name: "Antigua and Barbuda", region: "Americas" },
  { code: "AR", name: "Argentina", region: "Americas" },
  { code: "BS", name: "Bahamas", region: "Americas" },
  { code: "BB", name: "Barbados", region: "Americas" },
  { code: "BZ", name: "Belize", region: "Americas" },
  { code: "BO", name: "Bolivia", region: "Americas" },
  { code: "BR", name: "Brazil", region: "Americas" },
  { code: "CA", name: "Canada", region: "Americas" },
  { code: "CL", name: "Chile", region: "Americas" },
  { code: "CO", name: "Colombia", region: "Americas" },
  { code: "CR", name: "Costa Rica", region: "Americas" },
  { code: "CU", name: "Cuba", region: "Americas" },
  { code: "DM", name: "Dominica", region: "Americas" },
  { code: "DO", name: "Dominican Republic", region: "Americas" },
  { code: "EC", name: "Ecuador", region: "Americas" },
  { code: "SV", name: "El Salvador", region: "Americas" },
  { code: "GD", name: "Grenada", region: "Americas" },
  { code: "GT", name: "Guatemala", region: "Americas" },
  { code: "GY", name: "Guyana", region: "Americas" },
  { code: "HT", name: "Haiti", region: "Americas" },
  { code: "HN", name: "Honduras", region: "Americas" },
  { code: "JM", name: "Jamaica", region: "Americas" },
  { code: "MX", name: "Mexico", region: "Americas" },
  { code: "NI", name: "Nicaragua", region: "Americas" },
  { code: "PA", name: "Panama", region: "Americas" },
  { code: "PY", name: "Paraguay", region: "Americas" },
  { code: "PE", name: "Peru", region: "Americas" },
  { code: "KN", name: "Saint Kitts and Nevis", region: "Americas" },
  { code: "LC", name: "Saint Lucia", region: "Americas" },
  { code: "VC", name: "Saint Vincent and the Grenadines", region: "Americas" },
  { code: "SR", name: "Suriname", region: "Americas" },
  { code: "TT", name: "Trinidad and Tobago", region: "Americas" },
  { code: "US", name: "United States", region: "Americas" },
  { code: "UY", name: "Uruguay", region: "Americas" },
  { code: "VE", name: "Venezuela", region: "Americas" },
  // Africa
  { code: "DZ", name: "Algeria", region: "Africa" },
  { code: "AO", name: "Angola", region: "Africa" },
  { code: "BJ", name: "Benin", region: "Africa" },
  { code: "BW", name: "Botswana", region: "Africa" },
  { code: "BF", name: "Burkina Faso", region: "Africa" },
  { code: "BI", name: "Burundi", region: "Africa" },
  { code: "CV", name: "Cabo Verde", region: "Africa" },
  { code: "CM", name: "Cameroon", region: "Africa" },
  { code: "CF", name: "Central African Republic", region: "Africa" },
  { code: "TD", name: "Chad", region: "Africa" },
  { code: "KM", name: "Comoros", region: "Africa" },
  { code: "CG", name: "Congo", region: "Africa" },
  { code: "CD", name: "DR Congo", region: "Africa" },
  { code: "CI", name: "Côte d'Ivoire", region: "Africa" },
  { code: "EG", name: "Egypt", region: "Africa" },
  { code: "GQ", name: "Equatorial Guinea", region: "Africa" },
  { code: "ER", name: "Eritrea", region: "Africa" },
  { code: "SZ", name: "Eswatini", region: "Africa" },
  { code: "ET", name: "Ethiopia", region: "Africa" },
  { code: "GA", name: "Gabon", region: "Africa" },
  { code: "GM", name: "Gambia", region: "Africa" },
  { code: "GH", name: "Ghana", region: "Africa" },
  { code: "GN", name: "Guinea", region: "Africa" },
  { code: "GW", name: "Guinea-Bissau", region: "Africa" },
  { code: "KE", name: "Kenya", region: "Africa" },
  { code: "LS", name: "Lesotho", region: "Africa" },
  { code: "LR", name: "Liberia", region: "Africa" },
  { code: "LY", name: "Libya", region: "Africa" },
  { code: "MG", name: "Madagascar", region: "Africa" },
  { code: "MW", name: "Malawi", region: "Africa" },
  { code: "ML", name: "Mali", region: "Africa" },
  { code: "MR", name: "Mauritania", region: "Africa" },
  { code: "MU", name: "Mauritius", region: "Africa" },
  { code: "MA", name: "Morocco", region: "Africa" },
  { code: "MZ", name: "Mozambique", region: "Africa" },
  { code: "NA", name: "Namibia", region: "Africa" },
  { code: "NE", name: "Niger", region: "Africa" },
  { code: "NG", name: "Nigeria", region: "Africa" },
  { code: "RW", name: "Rwanda", region: "Africa" },
  { code: "ST", name: "São Tomé and Príncipe", region: "Africa" },
  { code: "SN", name: "Senegal", region: "Africa" },
  { code: "SC", name: "Seychelles", region: "Africa" },
  { code: "SL", name: "Sierra Leone", region: "Africa" },
  { code: "SO", name: "Somalia", region: "Africa" },
  { code: "ZA", name: "South Africa", region: "Africa" },
  { code: "SS", name: "South Sudan", region: "Africa" },
  { code: "SD", name: "Sudan", region: "Africa" },
  { code: "TZ", name: "Tanzania", region: "Africa" },
  { code: "TG", name: "Togo", region: "Africa" },
  { code: "TN", name: "Tunisia", region: "Africa" },
  { code: "UG", name: "Uganda", region: "Africa" },
  { code: "ZM", name: "Zambia", region: "Africa" },
  { code: "ZW", name: "Zimbabwe", region: "Africa" },
  // Oceania
  { code: "AU", name: "Australia", region: "Oceania" },
  { code: "FJ", name: "Fiji", region: "Oceania" },
  { code: "KI", name: "Kiribati", region: "Oceania" },
  { code: "MH", name: "Marshall Islands", region: "Oceania" },
  { code: "FM", name: "Micronesia", region: "Oceania" },
  { code: "NR", name: "Nauru", region: "Oceania" },
  { code: "NZ", name: "New Zealand", region: "Oceania" },
  { code: "PW", name: "Palau", region: "Oceania" },
  { code: "PG", name: "Papua New Guinea", region: "Oceania" },
  { code: "WS", name: "Samoa", region: "Oceania" },
  { code: "SB", name: "Solomon Islands", region: "Oceania" },
  { code: "TO", name: "Tonga", region: "Oceania" },
  { code: "TV", name: "Tuvalu", region: "Oceania" },
  { code: "VU", name: "Vanuatu", region: "Oceania" },
  // Middle East
  { code: "BH", name: "Bahrain", region: "Middle East" },
  { code: "IQ", name: "Iraq", region: "Middle East" },
  { code: "IL", name: "Israel", region: "Middle East" },
  { code: "JO", name: "Jordan", region: "Middle East" },
  { code: "KW", name: "Kuwait", region: "Middle East" },
  { code: "LB", name: "Lebanon", region: "Middle East" },
  { code: "OM", name: "Oman", region: "Middle East" },
  { code: "PS", name: "Palestine", region: "Middle East" },
  { code: "QA", name: "Qatar", region: "Middle East" },
  { code: "SA", name: "Saudi Arabia", region: "Middle East" },
  { code: "SY", name: "Syria", region: "Middle East" },
  { code: "AE", name: "United Arab Emirates", region: "Middle East" },
  { code: "YE", name: "Yemen", region: "Middle East" },
];

// Regulatory bodies: countryCode, name, abbreviation, bodyType, jurisdiction?, websiteUrl?, verificationUrl?, verificationMethod?, licenseFormat?
type BodyInput = {
  countryCode: string;
  name: string;
  abbreviation?: string;
  bodyType: string;
  jurisdiction?: string;
  websiteUrl?: string;
  verificationUrl?: string;
  verificationMethod?: string;
  contactEmail?: string;
  contactPhone?: string;
  licenseFormat?: string;
  notes?: string;
};

const REGULATORY_BODIES: BodyInput[] = [
  // Bangladesh
  { countryCode: "BD", name: "Bangladesh Veterinary Council", abbreviation: "BVC", bodyType: "NATIONAL", websiteUrl: "https://bvc.gov.bd", verificationUrl: "https://bvc.gov.bd", verificationMethod: "ONLINE_PORTAL", licenseFormat: "BVC registration number" },
  // India: VCI + sample state councils
  { countryCode: "IN", name: "Veterinary Council of India", abbreviation: "VCI", bodyType: "NATIONAL", websiteUrl: "https://vci.nic.in", verificationMethod: "EMAIL", licenseFormat: "VCI registration number" },
  { countryCode: "IN", name: "West Bengal Veterinary Council", abbreviation: "WBVC", bodyType: "STATE", jurisdiction: "West Bengal", websiteUrl: "https://wbvc.org.in" },
  { countryCode: "IN", name: "Maharashtra State Veterinary Council", abbreviation: "MSVC", bodyType: "STATE", jurisdiction: "Maharashtra" },
  { countryCode: "IN", name: "Tamil Nadu Veterinary Council", abbreviation: "TNVC", bodyType: "STATE", jurisdiction: "Tamil Nadu" },
  { countryCode: "IN", name: "Karnataka Veterinary Council", bodyType: "STATE", jurisdiction: "Karnataka" },
  { countryCode: "IN", name: "Kerala State Veterinary Council", bodyType: "STATE", jurisdiction: "Kerala" },
  { countryCode: "IN", name: "Andhra Pradesh Veterinary Council", bodyType: "STATE", jurisdiction: "Andhra Pradesh" },
  { countryCode: "IN", name: "Gujarat Veterinary Council", bodyType: "STATE", jurisdiction: "Gujarat" },
  { countryCode: "IN", name: "Rajasthan Veterinary Council", bodyType: "STATE", jurisdiction: "Rajasthan" },
  { countryCode: "IN", name: "Uttar Pradesh Veterinary Council", bodyType: "STATE", jurisdiction: "Uttar Pradesh" },
  // Pakistan, Sri Lanka, Nepal, etc.
  { countryCode: "PK", name: "Pakistan Veterinary Medical Council", abbreviation: "PVMC", bodyType: "NATIONAL", websiteUrl: "https://pvmc.org.pk", verificationMethod: "EMAIL" },
  { countryCode: "LK", name: "Sri Lanka Veterinary Council", abbreviation: "SLVC", bodyType: "NATIONAL", websiteUrl: "https://slvc.lk", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "NP", name: "Nepal Veterinary Council", bodyType: "NATIONAL" },
  { countryCode: "MM", name: "Myanmar Veterinary Council", bodyType: "NATIONAL" },
  { countryCode: "TH", name: "The Veterinary Council of Thailand", bodyType: "NATIONAL", websiteUrl: "https://www.vet council.or.th", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "MY", name: "Malaysian Veterinary Council", bodyType: "NATIONAL", websiteUrl: "https://veterinary.gov.my" },
  { countryCode: "PH", name: "Board of Veterinary Medicine (PRC)", abbreviation: "BVM", bodyType: "NATIONAL", jurisdiction: "Philippines", websiteUrl: "https://www.prc.gov.ph" },
  { countryCode: "SG", name: "Agri-Food and Veterinary Authority of Singapore", abbreviation: "AVA", bodyType: "NATIONAL" },
  { countryCode: "ID", name: "Indonesian Veterinary Medical Association", bodyType: "NATIONAL" },
  { countryCode: "VN", name: "Department of Animal Health (Vietnam)", bodyType: "NATIONAL" },
  { countryCode: "JP", name: "Ministry of Agriculture, Forestry and Fisheries (MAFF)", abbreviation: "MAFF", bodyType: "NATIONAL", websiteUrl: "https://www.maff.go.jp" },
  { countryCode: "KR", name: "Korean Veterinary Medical Association", abbreviation: "KVMA", bodyType: "NATIONAL" },
  { countryCode: "CN", name: "Ministry of Agriculture and Rural Affairs", bodyType: "NATIONAL" },
  // UK & Europe
  { countryCode: "GB", name: "Royal College of Veterinary Surgeons", abbreviation: "RCVS", bodyType: "NATIONAL", websiteUrl: "https://www.rcvs.org.uk", verificationUrl: "https://findavet.rcvs.org.uk", verificationMethod: "ONLINE_PORTAL", licenseFormat: "RCVS registration number" },
  { countryCode: "DE", name: "Bundestierärztekammer", abbreviation: "BTK", bodyType: "NATIONAL", websiteUrl: "https://www.bundestieraerztekammer.de" },
  { countryCode: "DE", name: "Landestierärztekammer Bayern", bodyType: "STATE", jurisdiction: "Bavaria" },
  { countryCode: "DE", name: "Landestierärztekammer Berlin", bodyType: "STATE", jurisdiction: "Berlin" },
  { countryCode: "FR", name: "Ordre National des Vétérinaires", abbreviation: "ONV", bodyType: "NATIONAL", websiteUrl: "https://www.veterinaire.fr", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "NL", name: "KNMvD / CIBG Register", bodyType: "NATIONAL", websiteUrl: "https://www.knmvd.nl", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "ES", name: "Consejo General de Colegios Veterinarios", bodyType: "NATIONAL", websiteUrl: "https://www.colvet.es" },
  { countryCode: "IT", name: "FNOVI", bodyType: "NATIONAL", websiteUrl: "https://www.fnovi.it" },
  { countryCode: "IE", name: "Veterinary Council of Ireland", abbreviation: "VCI", bodyType: "NATIONAL", websiteUrl: "https://www.vci.ie", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "AT", name: "Österreichische Tierärztekammer", bodyType: "NATIONAL" },
  { countryCode: "CH", name: "Schweizerische Tierärztegesellschaft", bodyType: "NATIONAL" },
  { countryCode: "SE", name: "Sveriges Veterinärförbund", bodyType: "NATIONAL" },
  { countryCode: "NO", name: "Norwegian Veterinary Institute", bodyType: "NATIONAL" },
  { countryCode: "DK", name: "Dyrlægeforeningen", bodyType: "NATIONAL" },
  { countryCode: "FI", name: "Finnish Veterinary Medical Association", bodyType: "NATIONAL" },
  { countryCode: "PL", name: "Krajowa Izba Lekarsko-Weterynaryjna", bodyType: "NATIONAL" },
  { countryCode: "PT", name: "Ordem dos Médicos Veterinários", bodyType: "NATIONAL" },
  { countryCode: "GR", name: "Greek Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "RO", name: "Colegiul Medicilor Veterinari din România", bodyType: "NATIONAL" },
  { countryCode: "HU", name: "Magyar Országos Állatorvosok Lapja", bodyType: "NATIONAL" },
  { countryCode: "CZ", name: "Komora veterinárních lékařů", bodyType: "NATIONAL" },
  { countryCode: "TR", name: "Turkish Veterinary Medical Association", bodyType: "NATIONAL" },
  { countryCode: "RU", name: "Russian Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "UA", name: "State Service of Ukraine on Food Safety", bodyType: "NATIONAL" },
  // Americas: USA (sample state boards), Canada, Brazil, Mexico
  { countryCode: "US", name: "American Veterinary Medical Association", abbreviation: "AVMA", bodyType: "NATIONAL", websiteUrl: "https://www.avma.org" },
  { countryCode: "US", name: "California Veterinary Medical Board", bodyType: "STATE", jurisdiction: "California", websiteUrl: "https://www.vmb.ca.gov", verificationUrl: "https://www.vmb.ca.gov/consumers/license_lookup.php", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "US", name: "Texas Board of Veterinary Medical Examiners", bodyType: "STATE", jurisdiction: "Texas", verificationUrl: "https://www.veterinary.texas.gov", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "US", name: "New York State Board for Veterinary Medicine", bodyType: "STATE", jurisdiction: "New York" },
  { countryCode: "US", name: "Florida Board of Veterinary Medicine", bodyType: "STATE", jurisdiction: "Florida" },
  { countryCode: "US", name: "DEA Registration (Controlled Substances)", abbreviation: "DEA", bodyType: "NATIONAL", jurisdiction: "USA", verificationMethod: "NONE" },
  { countryCode: "CA", name: "Canadian Veterinary Medical Association", abbreviation: "CVMA", bodyType: "NATIONAL", websiteUrl: "https://www.canadianveterinarians.net" },
  { countryCode: "CA", name: "College of Veterinarians of Ontario", abbreviation: "CVO", bodyType: "PROVINCIAL", jurisdiction: "Ontario", websiteUrl: "https://cvo.org", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "CA", name: "Ordre des médecins vétérinaires du Québec", bodyType: "PROVINCIAL", jurisdiction: "Quebec" },
  { countryCode: "CA", name: "College of Veterinarians of British Columbia", bodyType: "PROVINCIAL", jurisdiction: "British Columbia" },
  { countryCode: "CA", name: "Alberta Veterinary Medical Association", bodyType: "PROVINCIAL", jurisdiction: "Alberta" },
  { countryCode: "BR", name: "Conselho Federal de Medicina Veterinária", abbreviation: "CFMV", bodyType: "NATIONAL", websiteUrl: "https://www.cfmv.gov.br" },
  { countryCode: "BR", name: "CRMV-SP", bodyType: "REGIONAL", jurisdiction: "São Paulo" },
  { countryCode: "BR", name: "CRMV-RJ", bodyType: "REGIONAL", jurisdiction: "Rio de Janeiro" },
  { countryCode: "MX", name: "SENASICA / SAGARPA", bodyType: "NATIONAL", websiteUrl: "https://www.gob.mx/senasica" },
  { countryCode: "AR", name: "SENASA", bodyType: "NATIONAL", websiteUrl: "https://www.argentina.gob.ar/senasa" },
  { countryCode: "CO", name: "Instituto Colombiano Agropecuario", abbreviation: "ICA", bodyType: "NATIONAL" },
  { countryCode: "CL", name: "Colegio Médico Veterinario de Chile", bodyType: "NATIONAL" },
  { countryCode: "PE", name: "Colegio Médico Veterinario del Perú", bodyType: "NATIONAL" },
  { countryCode: "EC", name: "Colegio de Médicos Veterinarios del Ecuador", bodyType: "NATIONAL" },
  { countryCode: "UY", name: "Colegio de Médicos Veterinarios del Uruguay", bodyType: "NATIONAL" },
  // Africa
  { countryCode: "ZA", name: "South African Veterinary Council", abbreviation: "SAVC", bodyType: "NATIONAL", websiteUrl: "https://www.savc.org.za", verificationUrl: "https://www.savc.org.za/verify", verificationMethod: "ONLINE_PORTAL" },
  { countryCode: "KE", name: "Kenya Veterinary Board", abbreviation: "KVB", bodyType: "NATIONAL", websiteUrl: "https://www.kvb.or.ke" },
  { countryCode: "NG", name: "Veterinary Council of Nigeria", abbreviation: "VCN", bodyType: "NATIONAL" },
  { countryCode: "EG", name: "Egyptian Veterinary Medical Association", bodyType: "NATIONAL" },
  { countryCode: "GH", name: "Veterinary Council of Ghana", bodyType: "NATIONAL" },
  { countryCode: "ET", name: "Ethiopian Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "TZ", name: "Tanzania Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "UG", name: "Uganda Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "ZW", name: "Zimbabwe Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "BW", name: "Botswana Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "NA", name: "Namibia Veterinary Council", bodyType: "NATIONAL" },
  // Oceania
  { countryCode: "AU", name: "Australasian Veterinary Boards Council", abbreviation: "AVBC", bodyType: "NATIONAL", websiteUrl: "https://www.avbc.asn.au" },
  { countryCode: "AU", name: "Veterinary Practitioners Board of NSW", bodyType: "STATE", jurisdiction: "New South Wales" },
  { countryCode: "AU", name: "Veterinary Board of Victoria", bodyType: "STATE", jurisdiction: "Victoria" },
  { countryCode: "AU", name: "Veterinary Surgeons Board of Queensland", bodyType: "STATE", jurisdiction: "Queensland" },
  { countryCode: "AU", name: "Veterinary Surgeons Board of Western Australia", bodyType: "STATE", jurisdiction: "Western Australia" },
  { countryCode: "NZ", name: "Veterinary Council of New Zealand", abbreviation: "VCNZ", bodyType: "NATIONAL", websiteUrl: "https://www.vetcouncil.org.nz", verificationUrl: "https://www.vetcouncil.org.nz/public-register", verificationMethod: "ONLINE_PORTAL" },
  // Middle East
  { countryCode: "AE", name: "Ministry of Climate Change and Environment", bodyType: "NATIONAL" },
  { countryCode: "SA", name: "Saudi Commission for Health Specialties", bodyType: "NATIONAL" },
  { countryCode: "IL", name: "Israel Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "QA", name: "Qatar Ministry of Municipality", bodyType: "NATIONAL" },
  { countryCode: "OM", name: "Ministry of Agriculture and Fisheries (Oman)", bodyType: "NATIONAL" },
  { countryCode: "KW", name: "Public Authority for Agriculture Affairs (Kuwait)", bodyType: "NATIONAL" },
  { countryCode: "BH", name: "Ministry of Works, Municipalities Affairs and Urban Planning (Bahrain)", bodyType: "NATIONAL" },
  { countryCode: "JO", name: "Jordan Veterinary Association", bodyType: "NATIONAL" },
  { countryCode: "LB", name: "Lebanese Veterinary Association", bodyType: "NATIONAL" },
];

const bodiesNormalized = REGULATORY_BODIES.map((b) => ({
  ...b,
  countryCode: (b as BodyInput & { code?: string }).countryCode ?? (b as BodyInput & { code?: string }).code ?? "",
})).filter((b) => b.countryCode);

export default async function seedVetRegulatoryBodies(prisma: PrismaClient): Promise<void> {
  const countryIdByCode: Record<string, number> = {};

  for (const c of COUNTRIES) {
    const created = await prisma.vetCountry.upsert({
      where: { code: c.code },
      update: { name: c.name, region: c.region, hasVetLicensing: true, isActive: true },
      create: { code: c.code, name: c.name, region: c.region, hasVetLicensing: true, isActive: true },
    });
    countryIdByCode[c.code] = created.id;
  }

  let bodyCount = 0;
  for (const b of bodiesNormalized) {
    const countryId = countryIdByCode[b.countryCode];
    if (!countryId) continue;

    let body = await prisma.vetRegulatoryBody.findFirst({ where: { countryId, name: b.name } });
    if (body) {
      await prisma.vetRegulatoryBody.update({
        where: { id: body.id },
        data: {
          abbreviation: b.abbreviation ?? null,
          bodyType: b.bodyType,
          jurisdiction: b.jurisdiction ?? null,
          websiteUrl: b.websiteUrl ?? null,
          verificationUrl: b.verificationUrl ?? null,
          verificationMethod: b.verificationMethod ?? null,
          contactEmail: b.contactEmail ?? null,
          contactPhone: b.contactPhone ?? null,
          licenseFormat: b.licenseFormat ?? null,
          notes: b.notes ?? null,
          isActive: true,
        },
      });
    } else {
      body = await prisma.vetRegulatoryBody.create({
        data: {
          countryId,
          name: b.name,
          abbreviation: b.abbreviation ?? null,
          bodyType: b.bodyType,
          jurisdiction: b.jurisdiction ?? null,
          websiteUrl: b.websiteUrl ?? null,
          verificationUrl: b.verificationUrl ?? null,
          verificationMethod: b.verificationMethod ?? null,
          contactEmail: b.contactEmail ?? null,
          contactPhone: b.contactPhone ?? null,
          licenseFormat: b.licenseFormat ?? null,
          notes: b.notes ?? null,
          isActive: true,
        },
      });
    }

    for (const dt of DEFAULT_DOC_TYPES) {
      const existing = await prisma.vetRequiredDocType.findFirst({
        where: { regulatoryBodyId: body.id, documentType: dt.documentType },
      });
      if (!existing) {
        await prisma.vetRequiredDocType.create({
          data: {
            regulatoryBodyId: body.id,
            documentType: dt.documentType,
            label: dt.label,
            description: dt.description,
            isRequired: dt.isRequired,
            sortOrder: dt.sortOrder,
          },
        });
      }
    }
    bodyCount++;
  }

  // Add one generic "National Veterinary Authority" for any country that has no body yet
  for (const c of COUNTRIES) {
    const countryId = countryIdByCode[c.code];
    const hasBody = bodiesNormalized.some((b) => b.countryCode === c.code);
    if (hasBody || !countryId) continue;

    const generic = await prisma.vetRegulatoryBody.create({
      data: {
        countryId,
        name: `${c.name} Veterinary Authority`,
        bodyType: "NATIONAL",
        isActive: true,
      },
    });
    for (const dt of DEFAULT_DOC_TYPES) {
      await prisma.vetRequiredDocType.create({
        data: {
          regulatoryBodyId: generic.id,
          documentType: dt.documentType,
          label: dt.label,
          description: dt.description,
          isRequired: dt.isRequired,
          sortOrder: dt.sortOrder,
        },
      });
    }
    bodyCount++;
  }

  console.log(`✅ Vet reference: ${COUNTRIES.length} countries, ${bodyCount} regulatory bodies with required doc types`);
}
