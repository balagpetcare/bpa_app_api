import type { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { pickDelegate } from '../_utils/modelResolver';

type Row = {
  ccCode: string;
  zoneCode: string;
  wardCode: string;
  areaCode: string;
  nameBn: string;
  nameEn: string;
};

function parseCsv(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((s) => s.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iCc = idx('ccCode');
  const iZone = idx('zoneCode');
  const iWard = idx('wardCode');
  const iArea = idx('areaCode');
  const iBn = idx('nameBn');
  const iEn = idx('nameEn');

  const required = [iCc, iZone, iWard, iArea, iBn, iEn];
  if (required.some((i) => i < 0)) {
    throw new Error(
      `Invalid CSV header. Required columns: ccCode, zoneCode, wardCode, areaCode, nameBn, nameEn. Found: ${header.join(', ')}`
    );
  }

  const rows: Row[] = [];
  for (let li = 1; li < lines.length; li++) {
    const parts = lines[li].split(',').map((s) => s.trim());
    const row: Row = {
      ccCode: parts[iCc] ?? '',
      zoneCode: parts[iZone] ?? '',
      wardCode: parts[iWard] ?? '',
      areaCode: parts[iArea] ?? '',
      nameBn: parts[iBn] ?? '',
      nameEn: parts[iEn] ?? '',
    };
    if (!row.ccCode || !row.zoneCode || !row.wardCode || !row.areaCode || !row.nameBn || !row.nameEn) continue;
    rows.push(row);
  }
  return rows;
}

export async function runDhakaCityCsvSeed(prisma: PrismaClient) {
  console.log('🌱 BPA Dhaka City CSV seed starting...');

  const Division = pickDelegate(prisma, ['bdDivision', 'BdDivision', 'bd_division'], 'Division');
  const District = pickDelegate(prisma, ['bdDistrict', 'BdDistrict', 'bd_district'], 'District');
  const CityCorp = pickDelegate(prisma, ['bdCityCorporation', 'BdCityCorporation', 'bd_city_corporation'], 'CityCorporation');
  const Zone = pickDelegate(prisma, ['bdCcZone', 'BdCcZone', 'bd_cc_zone'], 'CcZone');
  const Ward = pickDelegate(prisma, ['bdCcWard', 'BdCcWard', 'bd_cc_ward'], 'CcWard');
  const Area = pickDelegate(prisma, ['bdCcArea', 'BdCcArea', 'bd_cc_area'], 'CcArea');

  // Base Division/District (change codes if you already use different ones)
  const dhakaDivision = await Division.upsert({
    where: { code: 'BD-30' },
    update: {},
    create: { code: 'BD-30', nameEn: 'Dhaka', nameBn: 'ঢাকা' },
  });

  const dhakaDistrict = await District.upsert({
    where: { code: 'BD-3026' },
    update: { divisionId: dhakaDivision.id },
    create: { code: 'BD-3026', nameEn: 'Dhaka', nameBn: 'ঢাকা', divisionId: dhakaDivision.id },
  });

  const dscc = await CityCorp.upsert({
    where: { code: 'DSCC' },
    update: { divisionId: dhakaDivision.id, districtId: dhakaDistrict.id },
    create: {
      code: 'DSCC',
      nameEn: 'Dhaka South City Corporation',
      nameBn: 'ঢাকা দক্ষিণ সিটি কর্পোরেশন',
      divisionId: dhakaDivision.id,
      districtId: dhakaDistrict.id,
    },
  });

  const dncc = await CityCorp.upsert({
    where: { code: 'DNCC' },
    update: { divisionId: dhakaDivision.id, districtId: dhakaDistrict.id },
    create: {
      code: 'DNCC',
      nameEn: 'Dhaka North City Corporation',
      nameBn: 'ঢাকা উত্তর সিটি কর্পোরেশন',
      divisionId: dhakaDivision.id,
      districtId: dhakaDistrict.id,
    },
  });

  const dataPath = path.join(__dirname, 'data', 'dhaka_city_areas.csv');
  if (!fs.existsSync(dataPath)) throw new Error(`CSV not found: ${dataPath}`);

  const rows = parseCsv(fs.readFileSync(dataPath, 'utf8'));
  if (rows.length === 0) {
    console.log('⚠️ No rows found in CSV. Nothing to seed.');
    return;
  }

  const zoneCache = new Map<string, any>();
  const wardCache = new Map<string, any>();
  const getCc = (code: string) => (code === 'DNCC' ? dncc : dscc);

  for (const r of rows) {
    const cc = getCc(r.ccCode);

    const zoneKey = `${r.ccCode}:${r.zoneCode}`;
    let zone = zoneCache.get(zoneKey);
    if (!zone) {
      zone = await Zone.upsert({
        where: { code: r.zoneCode },
        update: { cityCorporationId: cc.id },
        create: {
          code: r.zoneCode,
          nameEn: r.zoneCode,
          nameBn: r.zoneCode,
          cityCorporationId: cc.id,
        },
      });
      zoneCache.set(zoneKey, zone);
    }

    const wardKey = `${r.ccCode}:${r.wardCode}`;
    let ward = wardCache.get(wardKey);
    if (!ward) {
      ward = await Ward.upsert({
        where: { code: r.wardCode },
        update: { zoneId: zone.id, cityCorporationId: cc.id },
        create: {
          code: r.wardCode,
          nameEn: r.wardCode,
          nameBn: r.wardCode,
          zoneId: zone.id,
          cityCorporationId: cc.id,
        },
      });
      wardCache.set(wardKey, ward);
    }

    await Area.upsert({
      where: { code: r.areaCode },
      update: { nameBn: r.nameBn, nameEn: r.nameEn, wardId: ward.id, cityCorporationId: cc.id },
      create: { code: r.areaCode, nameBn: r.nameBn, nameEn: r.nameEn, wardId: ward.id, cityCorporationId: cc.id },
    });
  }

  console.log(`✅ Dhaka City CSV seed completed. Areas upserted: ${rows.length}`);
}
