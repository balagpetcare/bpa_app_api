import { PrismaClient } from '@prisma/client';
import type { SeededCorp } from './seedDhakaCityCorporations';
import type { SeededZones } from './seedDhakaCityZones';

type AreaSeed = {
  zoneCode: string; // BdArea.code of the parent zone
  code: string;     // unique BdArea.code
  nameEn: string;
  nameBn?: string;
};

function bn(input: string) {
  return input;
}

function makeUttaraSectors(): AreaSeed[] {
  const out: AreaSeed[] = [];
  for (let i = 1; i <= 18; i++) {
    const n = String(i).padStart(2, '0');
    out.push({
      zoneCode: 'ZONE-DNCC-UTTARA',
      code: `AREA-DNCC-UTTARA-SECTOR-${n}`,
      nameEn: `Uttara Sector ${i}`,
      nameBn: bn(`উত্তরা সেক্টর ${i}`),
    });
  }
  return out;
}

function makeMirpurNumbers(): AreaSeed[] {
  const nums = [1, 2, 6, 7, 10, 11, 12, 13, 14, 15];
  return nums.map((n) => ({
    zoneCode: 'ZONE-DNCC-MIRPUR',
    code: `AREA-DNCC-MIRPUR-${String(n).padStart(2, '0')}`,
    nameEn: `Mirpur ${n}`,
    nameBn: bn(`মিরপুর ${n}`),
  }));
}

const AREAS: AreaSeed[] = [
  // ========================= DNCC =========================
  ...makeUttaraSectors(),
  { zoneCode: 'ZONE-DNCC-UTTARA', code: 'AREA-DNCC-UTTARA-AZAMPUR', nameEn: 'Azampur', nameBn: 'আজমপুর' },
  { zoneCode: 'ZONE-DNCC-UTTARA', code: 'AREA-DNCC-UTTARA-HOUSE-BUILDING', nameEn: 'House Building', nameBn: 'হাউস বিল্ডিং' },
  { zoneCode: 'ZONE-DNCC-UTTARA', code: 'AREA-DNCC-UTTARA-JASHIMUDDIN', nameEn: 'Jashimuddin', nameBn: 'জসীমউদ্দীন' },
  { zoneCode: 'ZONE-DNCC-UTTARA', code: 'AREA-DNCC-UTTARA-DIABARI', nameEn: 'Diabari', nameBn: 'দিয়াবাড়ি' },
  { zoneCode: 'ZONE-DNCC-UTTARA', code: 'AREA-DNCC-UTTARA-ABDULLAHPUR', nameEn: 'Abdullahpur', nameBn: 'আবদুল্লাহপুর' },

  { zoneCode: 'ZONE-DNCC-AIRPORT', code: 'AREA-DNCC-AIRPORT-AIRPORT', nameEn: 'Hazrat Shahjalal International Airport', nameBn: 'হজরত শাহজালাল আন্তর্জাতিক বিমানবন্দর' },
  { zoneCode: 'ZONE-DNCC-AIRPORT', code: 'AREA-DNCC-AIRPORT-KAWLA', nameEn: 'Kawla', nameBn: 'কাওলা' },
  { zoneCode: 'ZONE-DNCC-AIRPORT', code: 'AREA-DNCC-AIRPORT-KURMITOLA', nameEn: 'Kurmitola', nameBn: 'কুর্মিটোলা' },
  { zoneCode: 'ZONE-DNCC-AIRPORT', code: 'AREA-DNCC-AIRPORT-NIKUNJA-1', nameEn: 'Nikunja 1', nameBn: 'নিকুঞ্জ ১' },
  { zoneCode: 'ZONE-DNCC-AIRPORT', code: 'AREA-DNCC-AIRPORT-NIKUNJA-2', nameEn: 'Nikunja 2', nameBn: 'নিকুঞ্জ ২' },
  { zoneCode: 'ZONE-DNCC-AIRPORT', code: 'AREA-DNCC-AIRPORT-KHILKHET-BUS-STOP', nameEn: 'Khilkhet Bus Stand', nameBn: 'খিলক্ষেত বাস স্ট্যান্ড' },

  { zoneCode: 'ZONE-DNCC-DAKKHINKHAN', code: 'AREA-DNCC-DAKKHINKHAN-DAKKHINKHAN', nameEn: 'Dakshinkhan', nameBn: 'দক্ষিণখান' },
  { zoneCode: 'ZONE-DNCC-DAKKHINKHAN', code: 'AREA-DNCC-DAKKHINKHAN-ASHKONA', nameEn: 'Ashkona', nameBn: 'আশকোনা' },
  { zoneCode: 'ZONE-DNCC-DAKKHINKHAN', code: 'AREA-DNCC-DAKKHINKHAN-HATIYARPARA', nameEn: 'Hatiyarpara', nameBn: 'হাতিয়ারপাড়া' },

  { zoneCode: 'ZONE-DNCC-UTTARKHAN', code: 'AREA-DNCC-UTTARKHAN-UTTARKHAN', nameEn: 'Uttarkhan', nameBn: 'উত্তরখান' },
  { zoneCode: 'ZONE-DNCC-UTTARKHAN', code: 'AREA-DNCC-UTTARKHAN-FAYEDABAD', nameEn: 'Fayedabad', nameBn: 'ফায়দাবাদ' },
  { zoneCode: 'ZONE-DNCC-UTTARKHAN', code: 'AREA-DNCC-UTTARKHAN-MOLLARTEK', nameEn: 'Mollartek', nameBn: 'মোল্লারটেক' },
  { zoneCode: 'ZONE-DNCC-UTTARKHAN', code: 'AREA-DNCC-UTTARKHAN-MOINARTEK', nameEn: 'Moinartek', nameBn: 'মইনারটেক' },

  { zoneCode: 'ZONE-DNCC-KHILKHET', code: 'AREA-DNCC-KHILKHET-KHILKHET', nameEn: 'Khilkhet', nameBn: 'খিলক্ষেত' },
  { zoneCode: 'ZONE-DNCC-KHILKHET', code: 'AREA-DNCC-KHILKHET-NOTUNBAZAR', nameEn: 'Notun Bazar', nameBn: 'নতুন বাজার' },
  { zoneCode: 'ZONE-DNCC-KHILKHET', code: 'AREA-DNCC-KHILKHET-NURERCHALA', nameEn: 'Nurerchala', nameBn: 'নুরেরচালা' },
  { zoneCode: 'ZONE-DNCC-KHILKHET', code: 'AREA-DNCC-KHILKHET-BOT_TOLA', nameEn: 'Bottola (Khilkhet)', nameBn: 'বটতলা (খিলক্ষেত)' },
  { zoneCode: 'ZONE-DNCC-KHILKHET', code: 'AREA-DNCC-KHILKHET-JAGANNATHPUR', nameEn: 'Jagannathpur', nameBn: 'জগন্নাথপুর' },

  { zoneCode: 'ZONE-DNCC-BADDA', code: 'AREA-DNCC-BADDA-BADDA', nameEn: 'Badda', nameBn: 'বাড্ডা' },
  { zoneCode: 'ZONE-DNCC-BADDA', code: 'AREA-DNCC-BADDA-MERUL', nameEn: 'Merul Badda', nameBn: 'মেরুল বাড্ডা' },
  { zoneCode: 'ZONE-DNCC-BADDA', code: 'AREA-DNCC-BADDA-AFTABNAGAR', nameEn: 'Aftabnagar', nameBn: 'আফতাবনগর' },
  { zoneCode: 'ZONE-DNCC-BADDA', code: 'AREA-DNCC-BADDA-BASHUNDHARA', nameEn: 'Bashundhara R/A', nameBn: 'বসুন্ধরা আবাসিক এলাকা' },
  { zoneCode: 'ZONE-DNCC-BADDA', code: 'AREA-DNCC-BADDA-JAMUNA_FUTURE_PARK', nameEn: 'Jamuna Future Park Area', nameBn: 'যমুনা ফিউচার পার্ক এলাকা' },
  { zoneCode: 'ZONE-DNCC-BADDA', code: 'AREA-DNCC-BADDA-SHAHJADPUR', nameEn: 'Shahjadpur', nameBn: 'শাহজাদপুর' },

  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-01', nameEn: 'Gulshan 1', nameBn: 'গুলশান ১' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-02', nameEn: 'Gulshan 2', nameBn: 'গুলশান ২' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-BANANI', nameEn: 'Banani', nameBn: 'বনানী' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-BARIDHARA', nameEn: 'Baridhara', nameBn: 'বারিধারা' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-NIKETAN', nameEn: 'Niketan', nameBn: 'নিকেতন' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-MOHAKHALI', nameEn: 'Mohakhali', nameBn: 'মহাখালী' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-MOHAKHALI_DOHS', nameEn: 'Mohakhali DOHS', nameBn: 'মহাখালী ডিওএইচএস' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-BANANI_DOHS', nameEn: 'Banani DOHS', nameBn: 'বনানী ডিওএইচএস' },
  { zoneCode: 'ZONE-DNCC-GULSHAN', code: 'AREA-DNCC-GULSHAN-BARIDHARA_DOHS', nameEn: 'Baridhara DOHS', nameBn: 'বারিধারা ডিওএইচএস' },

  { zoneCode: 'ZONE-DNCC-TEJGAON', code: 'AREA-DNCC-TEJGAON-TEJGAON', nameEn: 'Tejgaon', nameBn: 'তেজগাঁও' },
  { zoneCode: 'ZONE-DNCC-TEJGAON', code: 'AREA-DNCC-TEJGAON-FARMGATE', nameEn: 'Farmgate', nameBn: 'ফার্মগেট' },
  { zoneCode: 'ZONE-DNCC-TEJGAON', code: 'AREA-DNCC-TEJGAON-KARWAN_BAZAR', nameEn: 'Karwan Bazar', nameBn: 'কারওয়ান বাজার' },
  { zoneCode: 'ZONE-DNCC-TEJGAON', code: 'AREA-DNCC-TEJGAON-NAKHALPARA', nameEn: 'Nakhalpara', nameBn: 'নাখালপাড়া' },
  { zoneCode: 'ZONE-DNCC-TEJGAON', code: 'AREA-DNCC-TEJGAON-MANIK_MIA_AVENUE', nameEn: 'Manik Mia Avenue', nameBn: 'মানিক মিয়া এভিনিউ' },
  { zoneCode: 'ZONE-DNCC-TEJGAON', code: 'AREA-DNCC-TEJGAON-TEJGAON_INDUSTRIAL', nameEn: 'Tejgaon Industrial Area', nameBn: 'তেজগাঁও শিল্প এলাকা' },

  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-MOHAMMADPUR', nameEn: 'Mohammadpur', nameBn: 'মোহাম্মদপুর' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-ADABOR', nameEn: 'Adabor', nameBn: 'আদাবর' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-SHYAMOLI', nameEn: 'Shyamoli', nameBn: 'শ্যামলী' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-LALMATIA', nameEn: 'Lalmatia', nameBn: 'লালমাটিয়া' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-ASADGATE', nameEn: 'Asadgate', nameBn: 'আসাদগেট' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-TAJMAHAL_ROAD', nameEn: 'Tajmahal Road', nameBn: 'তাজমহল রোড' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-BOSILA', nameEn: 'Bosila', nameBn: 'বসিলা' },
  { zoneCode: 'ZONE-DNCC-MOHAMMADPUR', code: 'AREA-DNCC-MOHAMMADPUR-JIGATOLA_EDGE', nameEn: 'Jigatola (Nearby)', nameBn: 'জিগাতলা (নিকটবর্তী)' },

  { zoneCode: 'ZONE-DNCC-SHER_E_BANGLA_NAGAR', code: 'AREA-DNCC-SHER_E_BANGLA_NAGAR-AGARGAON', nameEn: 'Agargaon', nameBn: 'আগারগাঁও' },
  { zoneCode: 'ZONE-DNCC-SHER_E_BANGLA_NAGAR', code: 'AREA-DNCC-SHER_E_BANGLA_NAGAR-SHER_E_BANGLA_NAGAR', nameEn: 'Sher-e-Bangla Nagar', nameBn: 'শেরেবাংলা নগর' },
  { zoneCode: 'ZONE-DNCC-SHER_E_BANGLA_NAGAR', code: 'AREA-DNCC-SHER_E_BANGLA_NAGAR-BIJLIMAHAL', nameEn: 'Bijli Mohalla (Agargaon)', nameBn: 'বিদ্যুৎ মহল্লা (আগারগাঁও)' },
  { zoneCode: 'ZONE-DNCC-SHER_E_BANGLA_NAGAR', code: 'AREA-DNCC-SHER_E_BANGLA_NAGAR-TALTOLA', nameEn: 'Taltola (Agargaon)', nameBn: 'তালতলা (আগারগাঁও)' },

  ...makeMirpurNumbers(),
  { zoneCode: 'ZONE-DNCC-MIRPUR', code: 'AREA-DNCC-MIRPUR-DOHS', nameEn: 'Mirpur DOHS', nameBn: 'মিরপুর ডিওএইচএস' },
  { zoneCode: 'ZONE-DNCC-MIRPUR', code: 'AREA-DNCC-MIRPUR-KAZIPARA', nameEn: 'Kazipara', nameBn: 'কাজীপাড়া' },
  { zoneCode: 'ZONE-DNCC-MIRPUR', code: 'AREA-DNCC-MIRPUR-SHEWRAPARA', nameEn: 'Shewrapara', nameBn: 'শেওড়াপাড়া' },
  { zoneCode: 'ZONE-DNCC-MIRPUR', code: 'AREA-DNCC-MIRPUR-RUPNAGAR', nameEn: 'Rupnagar', nameBn: 'রূপনগর' },
  { zoneCode: 'ZONE-DNCC-MIRPUR', code: 'AREA-DNCC-MIRPUR-TECHNICAL', nameEn: 'Technical', nameBn: 'টেকনিক্যাল' },
  { zoneCode: 'ZONE-DNCC-MIRPUR', code: 'AREA-DNCC-MIRPUR-ZOO', nameEn: 'National Zoo Area', nameBn: 'চিড়িয়াখানা এলাকা' },

  { zoneCode: 'ZONE-DNCC-PALLABI', code: 'AREA-DNCC-PALLABI-PALLABI', nameEn: 'Pallabi', nameBn: 'পল্লবী' },
  { zoneCode: 'ZONE-DNCC-PALLABI', code: 'AREA-DNCC-PALLABI-KALSHI', nameEn: 'Kalshi', nameBn: 'কালশী' },
  { zoneCode: 'ZONE-DNCC-PALLABI', code: 'AREA-DNCC-PALLABI-ECB_CHATTER', nameEn: 'ECB Chattar', nameBn: 'ইসিবি চত্বর' },
  { zoneCode: 'ZONE-DNCC-PALLABI', code: 'AREA-DNCC-PALLABI-MATIKATA', nameEn: 'Matikata', nameBn: 'মাটিকাটা' },

  { zoneCode: 'ZONE-DNCC-KAFRUL', code: 'AREA-DNCC-KAFRUL-KAFRUL', nameEn: 'Kafrul', nameBn: 'কাফরুল' },
  { zoneCode: 'ZONE-DNCC-KAFRUL', code: 'AREA-DNCC-KAFRUL-IBRAHIMPUR', nameEn: 'Ibrahimpur', nameBn: 'ইব্রাহিমপুর' },
  { zoneCode: 'ZONE-DNCC-KAFRUL', code: 'AREA-DNCC-KAFRUL-TALTOLA', nameEn: 'Taltola (Kafrul)', nameBn: 'তালতলা (কাফরুল)' },
  { zoneCode: 'ZONE-DNCC-KAFRUL', code: 'AREA-DNCC-KAFRUL-CANTONMENT', nameEn: 'Dhaka Cantonment', nameBn: 'ঢাকা ক্যান্টনমেন্ট' },
  { zoneCode: 'ZONE-DNCC-KAFRUL', code: 'AREA-DNCC-KAFRUL-SHAHEEN_BAGH', nameEn: 'Shaheen Bagh', nameBn: 'শাহীনবাগ' },

  // ========================= DSCC =========================
  { zoneCode: 'ZONE-DSCC-DHANMONDI', code: 'AREA-DSCC-DHANMONDI-DHANMONDI', nameEn: 'Dhanmondi', nameBn: 'ধানমন্ডি' },
  { zoneCode: 'ZONE-DSCC-DHANMONDI', code: 'AREA-DSCC-DHANMONDI-27', nameEn: 'Dhanmondi 27', nameBn: 'ধানমন্ডি ২৭' },
  { zoneCode: 'ZONE-DSCC-DHANMONDI', code: 'AREA-DSCC-DHANMONDI-32', nameEn: 'Dhanmondi 32', nameBn: 'ধানমন্ডি ৩২' },
  { zoneCode: 'ZONE-DSCC-DHANMONDI', code: 'AREA-DSCC-DHANMONDI-KALABAGAN', nameEn: 'Kalabagan', nameBn: 'কলাবাগান' },
  { zoneCode: 'ZONE-DSCC-DHANMONDI', code: 'AREA-DSCC-DHANMONDI-JIGATOLA', nameEn: 'Jigatola', nameBn: 'জিগাতলা' },
  { zoneCode: 'ZONE-DSCC-DHANMONDI', code: 'AREA-DSCC-DHANMONDI-KATABON_EDGE', nameEn: 'Katabon (Nearby)', nameBn: 'কাটাবন (নিকটবর্তী)' },

  { zoneCode: 'ZONE-DSCC-NEW_MARKET', code: 'AREA-DSCC-NEW_MARKET-NEW_MARKET', nameEn: 'New Market', nameBn: 'নিউ মার্কেট' },
  { zoneCode: 'ZONE-DSCC-NEW_MARKET', code: 'AREA-DSCC-NEW_MARKET-NILKHET', nameEn: 'Nilkhet', nameBn: 'নীলক্ষেত' },
  { zoneCode: 'ZONE-DSCC-NEW_MARKET', code: 'AREA-DSCC-NEW_MARKET-KATABON', nameEn: 'Katabon', nameBn: 'কাটাবন' },
  { zoneCode: 'ZONE-DSCC-NEW_MARKET', code: 'AREA-DSCC-NEW_MARKET-AZIMPUR', nameEn: 'Azimpur', nameBn: 'আজিমপুর' },
  { zoneCode: 'ZONE-DSCC-NEW_MARKET', code: 'AREA-DSCC-NEW_MARKET-LALBAGH_FORT', nameEn: 'Lalbagh Fort Area', nameBn: 'লালবাগ কেল্লা এলাকা' },

  { zoneCode: 'ZONE-DSCC-RAMNA', code: 'AREA-DSCC-RAMNA-RAMNA', nameEn: 'Ramna', nameBn: 'রমনা' },
  { zoneCode: 'ZONE-DSCC-RAMNA', code: 'AREA-DSCC-RAMNA-SHAHBAGH', nameEn: 'Shahbagh', nameBn: 'শাহবাগ' },
  { zoneCode: 'ZONE-DSCC-RAMNA', code: 'AREA-DSCC-RAMNA-DHAKA_UNIVERSITY', nameEn: 'Dhaka University', nameBn: 'ঢাকা বিশ্ববিদ্যালয়' },
  { zoneCode: 'ZONE-DSCC-RAMNA', code: 'AREA-DSCC-RAMNA-ESKATON', nameEn: 'Eskaton', nameBn: 'ইস্কাটন' },
  { zoneCode: 'ZONE-DSCC-RAMNA', code: 'AREA-DSCC-RAMNA-MOGHBAZAR', nameEn: 'Moghbazar', nameBn: 'মগবাজার' },

  { zoneCode: 'ZONE-DSCC-PALTAN', code: 'AREA-DSCC-PALTAN-PALTAN', nameEn: 'Paltan', nameBn: 'পল্টন' },
  { zoneCode: 'ZONE-DSCC-PALTAN', code: 'AREA-DSCC-PALTAN-NAYA_PALTAN', nameEn: 'Naya Paltan', nameBn: 'নয়া পল্টন' },
  { zoneCode: 'ZONE-DSCC-PALTAN', code: 'AREA-DSCC-PALTAN-KAKRAIL', nameEn: 'Kakrail', nameBn: 'কাকরাইল' },
  { zoneCode: 'ZONE-DSCC-PALTAN', code: 'AREA-DSCC-PALTAN-BIJOY_NAGAR', nameEn: 'Bijoy Nagar', nameBn: 'বিজয় নগর' },
  { zoneCode: 'ZONE-DSCC-PALTAN', code: 'AREA-DSCC-PALTAN-FAKIRAPOOL', nameEn: 'Fakirapool', nameBn: 'ফকিরাপুল' },

  { zoneCode: 'ZONE-DSCC-MOTIJHEEL', code: 'AREA-DSCC-MOTIJHEEL-MOTIJHEEL', nameEn: 'Motijheel', nameBn: 'মতিঝিল' },
  { zoneCode: 'ZONE-DSCC-MOTIJHEEL', code: 'AREA-DSCC-MOTIJHEEL-DILKUSHA', nameEn: 'Dilkusha', nameBn: 'দিলকুশা' },
  { zoneCode: 'ZONE-DSCC-MOTIJHEEL', code: 'AREA-DSCC-MOTIJHEEL-KAMALAPUR', nameEn: 'Kamalapur', nameBn: 'কমলাপুর' },
  { zoneCode: 'ZONE-DSCC-MOTIJHEEL', code: 'AREA-DSCC-MOTIJHEEL-GOPIBAGH', nameEn: 'Gopibagh', nameBn: 'গোপীবাগ' },
  { zoneCode: 'ZONE-DSCC-MOTIJHEEL', code: 'AREA-DSCC-MOTIJHEEL-WARI', nameEn: 'Wari', nameBn: 'ওয়ারী' },

  { zoneCode: 'ZONE-DSCC-KHILGAON', code: 'AREA-DSCC-KHILGAON-KHILGAON', nameEn: 'Khilgaon', nameBn: 'খিলগাঁও' },
  { zoneCode: 'ZONE-DSCC-KHILGAON', code: 'AREA-DSCC-KHILGAON-MALIBAGH', nameEn: 'Malibagh', nameBn: 'মালিবাগ' },
  { zoneCode: 'ZONE-DSCC-KHILGAON', code: 'AREA-DSCC-KHILGAON-SHANTINAGAR', nameEn: 'Shantinagar', nameBn: 'শান্তিনগর' },
  { zoneCode: 'ZONE-DSCC-KHILGAON', code: 'AREA-DSCC-KHILGAON-GORAN', nameEn: 'Goran', nameBn: 'গোড়ান' },
  { zoneCode: 'ZONE-DSCC-KHILGAON', code: 'AREA-DSCC-KHILGAON-MANIKNAGAR', nameEn: 'Maniknagar', nameBn: 'মানিকনগর' },

  // Rampura / Banasree: user examples
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-RAMPURA', nameEn: 'Rampura', nameBn: 'রামপুরা' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-EAST_RAMPURA', nameEn: 'East Rampura', nameBn: 'পূর্ব রামপুরা' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-SOUTH_RAMPURA', nameEn: 'South Rampura', nameBn: 'দক্ষিণ রামপুরা' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-WEST_RAMPURA', nameEn: 'West Rampura', nameBn: 'পশ্চিম রামপুরা' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-BANASREE', nameEn: 'Banasree', nameBn: 'বনশ্রী' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-NORTH_BANASREE', nameEn: 'North Banasree', nameBn: 'উত্তর বনশ্রী' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-SOUTH_BANASREE', nameEn: 'South Banasree', nameBn: 'দক্ষিণ বনশ্রী' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-EAST_BANASREE', nameEn: 'East Banasree', nameBn: 'পূর্ব বনশ্রী' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-WEST_BANASREE', nameEn: 'West Banasree', nameBn: 'পশ্চিম বনশ্রী' },
  { zoneCode: 'ZONE-DSCC-RAMPURA', code: 'AREA-DSCC-RAMPURA-AFTABNAGAR_EDGE', nameEn: 'Aftabnagar (Nearby)', nameBn: 'আফতাবনগর (নিকটবর্তী)' },

  { zoneCode: 'ZONE-DSCC-BASHABO', code: 'AREA-DSCC-BASHABO-BASHABO', nameEn: 'Basabo', nameBn: 'বাসাবো' },
  { zoneCode: 'ZONE-DSCC-BASHABO', code: 'AREA-DSCC-BASHABO-SABUJBAGH', nameEn: 'Sabujbagh', nameBn: 'সবুজবাগ' },
  { zoneCode: 'ZONE-DSCC-BASHABO', code: 'AREA-DSCC-BASHABO-KADAMTOLI_EDGE', nameEn: 'Kadamtoli (Nearby)', nameBn: 'কদমতলী (নিকটবর্তী)' },
  { zoneCode: 'ZONE-DSCC-BASHABO', code: 'AREA-DSCC-BASHABO-MADARTEK', nameEn: 'Madartek', nameBn: 'মাদারটেক' },

  { zoneCode: 'ZONE-DSCC-JATRABARI', code: 'AREA-DSCC-JATRABARI-JATRABARI', nameEn: 'Jatrabari', nameBn: 'যাত্রাবাড়ী' },
  { zoneCode: 'ZONE-DSCC-JATRABARI', code: 'AREA-DSCC-JATRABARI-SHANIR_AKHRA', nameEn: 'Shanir Akhra', nameBn: 'শানির আখড়া' },
  { zoneCode: 'ZONE-DSCC-JATRABARI', code: 'AREA-DSCC-JATRABARI-KAZLA', nameEn: 'Kazla', nameBn: 'কাজলা' },
  { zoneCode: 'ZONE-DSCC-JATRABARI', code: 'AREA-DSCC-JATRABARI-KONAPARA', nameEn: 'Konapara', nameBn: 'কোনাপাড়া' },
  { zoneCode: 'ZONE-DSCC-JATRABARI', code: 'AREA-DSCC-JATRABARI-DONIA', nameEn: 'Donia', nameBn: 'ডনিয়া' },
  { zoneCode: 'ZONE-DSCC-JATRABARI', code: 'AREA-DSCC-JATRABARI-DHANIA', nameEn: 'Dhania', nameBn: 'ধানিয়া' },

  { zoneCode: 'ZONE-DSCC-DEMRA', code: 'AREA-DSCC-DEMRA-DEMRA', nameEn: 'Demra', nameBn: 'ডেমরা' },
  { zoneCode: 'ZONE-DSCC-DEMRA', code: 'AREA-DSCC-DEMRA-MATUAIL', nameEn: 'Matuail', nameBn: 'মাতুয়াইল' },
  { zoneCode: 'ZONE-DSCC-DEMRA', code: 'AREA-DSCC-DEMRA-SARULIA', nameEn: 'Sarulia', nameBn: 'সারুলিয়া' },
  { zoneCode: 'ZONE-DSCC-DEMRA', code: 'AREA-DSCC-DEMRA-KAYETPARA', nameEn: 'Kayetpara (Demra)', nameBn: 'কায়েতপাড়া (ডেমরা)' },

  { zoneCode: 'ZONE-DSCC-SHYAMPUR', code: 'AREA-DSCC-SHYAMPUR-SHYAMPUR', nameEn: 'Shyampur', nameBn: 'শ্যামপুর' },
  { zoneCode: 'ZONE-DSCC-SHYAMPUR', code: 'AREA-DSCC-SHYAMPUR-JURAIN', nameEn: 'Jurain', nameBn: 'জুরাইন' },
  { zoneCode: 'ZONE-DSCC-SHYAMPUR', code: 'AREA-DSCC-SHYAMPUR-KADAMTALI', nameEn: 'Kadamtali', nameBn: 'কদমতলী' },
  { zoneCode: 'ZONE-DSCC-SHYAMPUR', code: 'AREA-DSCC-SHYAMPUR-GANDARIA_EDGE', nameEn: 'Gandaria (Nearby)', nameBn: 'গেন্ডারিয়া (নিকটবর্তী)' },

  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-CHAWKBAZAR', nameEn: 'Chawkbazar', nameBn: 'চকবাজার' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-ISLAMPUR', nameEn: 'Islampur', nameBn: 'ইসলামপুর' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-SADARGHAT', nameEn: 'Sadarghat', nameBn: 'সদরঘাট' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-BANGLABAZAR', nameEn: 'Banglabazar', nameBn: 'বাংলাবাজার' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-SUTRAPUR', nameEn: 'Sutrapur', nameBn: 'সূত্রাপুর' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-NARINDA', nameEn: 'Narinda', nameBn: 'নারিন্দা' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-DHOLAIKHAL', nameEn: 'Dholai Khal', nameBn: 'ধোলাইখাল' },
  { zoneCode: 'ZONE-DSCC-OLD_DHAKA', code: 'AREA-DSCC-OLD_DHAKA-POSTOGOLA', nameEn: 'Postogola', nameBn: 'পোস্তগোলা' },

  { zoneCode: 'ZONE-DSCC-LALBAGH', code: 'AREA-DSCC-LALBAGH-LALBAGH', nameEn: 'Lalbagh', nameBn: 'লালবাগ' },
  { zoneCode: 'ZONE-DSCC-LALBAGH', code: 'AREA-DSCC-LALBAGH-KAMRANGIRCHAR', nameEn: 'Kamrangirchar', nameBn: 'কামরাঙ্গীরচর' },
  { zoneCode: 'ZONE-DSCC-LALBAGH', code: 'AREA-DSCC-LALBAGH-ISLAMBAGH', nameEn: 'Islambagh', nameBn: 'ইসলামবাগ' },

  { zoneCode: 'ZONE-DSCC-HAZARIBAGH', code: 'AREA-DSCC-HAZARIBAGH-HAZARIBAGH', nameEn: 'Hazaribagh', nameBn: 'হাজারীবাগ' },
  { zoneCode: 'ZONE-DSCC-HAZARIBAGH', code: 'AREA-DSCC-HAZARIBAGH-RAYERBAZAR', nameEn: 'Rayerbazar', nameBn: 'রায়েরবাজার' },
  { zoneCode: 'ZONE-DSCC-HAZARIBAGH', code: 'AREA-DSCC-HAZARIBAGH-ZIGATOLA_EDGE', nameEn: 'Zigatola (Nearby)', nameBn: 'জিগাতলা (নিকটবর্তী)' },
];

async function upsertArea(prisma: PrismaClient, args: {
  code: string;
  nameEn: string;
  nameBn?: string;
  districtId: number;
  parentId: number;
}) {
  // IMPORTANT:
  // Our BdArea table uses a courier-style uniqueness so the same AREA name can't repeat
  // under the same parent for the same type. So we upsert by the composite unique key
  // (parentId, nameEn, type) instead of `code`.
  return prisma.bdArea.upsert({
    where: {
      parentId_nameEn_type: {
        parentId: args.parentId,
        nameEn: args.nameEn,
        type: 'AREA',
      },
    },
    update: {
      nameEn: args.nameEn,
      nameBn: args.nameBn ?? null,
      type: 'AREA',
      districtId: args.districtId,
      parentId: args.parentId,
      upazilaId: null,
    },
    create: {
      code: args.code,
      nameEn: args.nameEn,
      nameBn: args.nameBn ?? null,
      type: 'AREA',
      districtId: args.districtId,
      parentId: args.parentId,
      upazilaId: null,
    },
  });
}

/**
 * Seeds Dhaka areas as BdArea nodes under courier-style zones.
 *
 * Resulting structure in bd_areas:
 *   CITY_CORPORATION (CC-DNCC/CC-DSCC)
 *     -> ZONE (ZONE-DNCC-UTTARA ...)
 *        -> AREA (AREA-...)
 */
export default async function seedDhakaCityAreas(
  prisma: PrismaClient,
  corp: SeededCorp,
  zones: SeededZones,
) {
  const zoneIdByCode: Record<string, number> = { ...zones.dncc, ...zones.dscc };

  for (const a of AREAS) {
    const parentId = zoneIdByCode[a.zoneCode];
    if (!parentId) continue;
    await upsertArea(prisma, {
      code: a.code,
      nameEn: a.nameEn,
      nameBn: a.nameBn,
      districtId: corp.dhakaDistrictId,
      parentId,
    });
  }
}
