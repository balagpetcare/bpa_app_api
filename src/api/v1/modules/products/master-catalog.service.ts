const prisma = require("../../../../infrastructure/db/prismaClient");
const { slugify } = require("../../../../utils/helpers");
const mediaService = require("../media/media.service");
const { parse } = require("csv-parse/sync");
const axios = require("axios").default || require("axios");

/**
 * Get master products with pagination and filters
 */
async function getMasterProducts(options: {
  search?: string;
  brandId?: number;
  categoryId?: number;
  isActive?: boolean;
  isVerified?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {
    isActive: options.isActive !== undefined ? options.isActive : true,
  };

  if (options.isVerified !== undefined) {
    where.isVerified = options.isVerified;
  }

  if (options.brandId) {
    where.brandId = options.brandId;
  }

  if (options.categoryId) {
    where.categoryId = options.categoryId;
  }

  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: "insensitive" } },
      { slug: { contains: options.search, mode: "insensitive" } },
      { description: { contains: options.search, mode: "insensitive" } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.masterProductCatalog.findMany({
      where,
      skip,
      take: limit,
      include: {
        company: {
          select: {
            id: true,
            name: true,
            country: true,
            website: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        primaryMedia: {
          select: {
            id: true,
            url: true,
            type: true,
          },
        },
        galleryMedia: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            sortOrder: true,
            media: {
              select: {
                id: true,
                url: true,
                type: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.masterProductCatalog.count({ where }),
  ]);

  return {
    items: products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

function escapeCsvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Generate master CSV template for Master Product Catalog bulk import.
 * One row per product variant. Same product_title + brand_name (+ optional global_sku)
 * merge into one master product with multiple variants.
 */
function generateMasterCatalogCsvTemplate(): string {
  const headers = [
    "company_name",
    "brand_name",
    "category_name",
    "subcategory_name",
    "global_sku",
    "product_title",
    "product_short_title",
    "product_slug",
    "short_description",
    "description",
    "bullet_points",
    "usage_instructions",
    "storage_instructions",
    "safety_warning",
    "country_of_origin",
    "status",
    "variant_sku",
    "variant_name",
    "pack_size",
    "pack_unit",
    "flavour",
    "age_group",
    "pet_type",
    "mrp",
    "min_price",
    "max_price",
    "variant_description",
    "is_default_variant",
    "primary_image_url",
    "gallery_image_url_1",
    "gallery_image_url_2",
    "gallery_image_url_3",
    "gallery_image_url_4",
    "gallery_image_url_5",
    "external_source",
    "external_product_id",
    "notes_internal",
  ];

  const rows: (string | number)[][] = [
    // --- Product 1: Royal Canin Kitten Dry Food (2 variants) ---
    [
      "Mars Petcare",
      "Royal Canin",
      "Food",
      "Dry Food",
      "RC-KITTEN-2KG",
      "Royal Canin Kitten Dry Food",
      "RC Kitten Dry",
      "",
      "Premium dry food for healthy kitten growth.",
      "Complete and balanced nutrition for kittens up to 12 months. Supports digestive health and immunity.",
      "Healthy growth|Digestive health|Strong immunity",
      "Feed according to the feeding guide on the pack. Always provide fresh water.",
      "Store in a cool, dry place away from direct sunlight.",
      "Not for human consumption. Keep away from children.",
      "France",
      "active",
      "RC-KITTEN-2KG",
      "2kg bag",
      "2",
      "kg",
      "",
      "Kitten",
      "Cat",
      "2300",
      "",
      "",
      "For kittens up to 12 months. 2kg pack.",
      "true",
      "https://example.com/images/rc-kitten-2kg.jpg",
      "",
      "",
      "",
      "",
      "",
      "",
      "seed",
      "example-rc-kitten-2kg",
      "Example row 1",
    ],
    [
      "Mars Petcare",
      "Royal Canin",
      "Food",
      "Dry Food",
      "RC-KITTEN-2KG",
      "Royal Canin Kitten Dry Food",
      "RC Kitten Dry",
      "",
      "Premium dry food for healthy kitten growth.",
      "Complete and balanced nutrition for kittens up to 12 months.",
      "Healthy growth|Digestive health|Strong immunity",
      "Feed according to the feeding guide on the pack.",
      "Store in a cool, dry place away from direct sunlight.",
      "Not for human consumption. Keep away from children.",
      "France",
      "active",
      "RC-KITTEN-4KG",
      "4kg bag",
      "4",
      "kg",
      "",
      "Kitten",
      "Cat",
      "4200",
      "",
      "",
      "For kittens up to 12 months. 4kg pack.",
      "false",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "seed",
      "example-rc-kitten-4kg",
      "Example row 2 – same product, second variant",
    ],
    // --- Product 2: Whiskas Temptations Cat Treats (2 variants) ---
    [
      "Mars Petcare",
      "Whiskas",
      "Cat Treats",
      "Training Treats",
      "WH-TEMP-60-CH",
      "Whiskas Temptations Cat Treats",
      "Whiskas Temptations",
      "",
      "Irresistible crunchy treats for cats.",
      "Irresistible treats for cats. Available in various flavors. Perfect for training or as a reward.",
      "Crunchy|Delicious|Training reward",
      "Give as a treat. Do not replace main meals.",
      "Store in a cool, dry place. Reseal after opening.",
      "Not for human consumption.",
      "Thailand",
      "active",
      "WH-TEMP-60-CH",
      "60g",
      "60",
      "g",
      "Chicken",
      "Adult",
      "Cat",
      "350",
      "",
      "",
      "Chicken flavor 60g.",
      "true",
      "https://example.com/images/whiskas-temptations-chicken.jpg",
      "",
      "",
      "",
      "",
      "",
      "",
      "seed",
      "example-whiskas-temptations-chicken",
      "Example row 3",
    ],
    [
      "Mars Petcare",
      "Whiskas",
      "Cat Treats",
      "Training Treats",
      "WH-TEMP-60-CH",
      "Whiskas Temptations Cat Treats",
      "Whiskas Temptations",
      "",
      "Irresistible crunchy treats for cats.",
      "Irresistible treats for cats. Available in various flavors.",
      "Crunchy|Delicious|Training reward",
      "Give as a treat. Do not replace main meals.",
      "Store in a cool, dry place. Reseal after opening.",
      "Not for human consumption.",
      "Thailand",
      "active",
      "WH-TEMP-60-TU",
      "60g",
      "60",
      "g",
      "Tuna",
      "Adult",
      "Cat",
      "350",
      "",
      "",
      "Tuna flavor 60g.",
      "false",
      "",
      "",
      "",
      "",
      "",
      "",
      "seed",
      "example-whiskas-temptations-tuna",
      "Example row 4 – same product, second variant",
    ],
    // --- Product 3: Pedigree Adult Dog Food (1 variant) ---
    [
      "Mars Petcare",
      "Pedigree",
      "Dog Food",
      "Dry Food",
      "PED-ADULT-3KG",
      "Pedigree Adult Dry Dog Food",
      "Pedigree Adult 3kg",
      "",
      "Complete nutrition for adult dogs.",
      "Complete and balanced dry food for adult dogs. Supports healthy digestion, skin and coat.",
      "Complete nutrition|Healthy digestion|Skin and coat",
      "Feed according to body weight. See pack for guide. Always provide water.",
      "Store in a cool, dry place. Keep bag closed.",
      "Not for human consumption. Keep away from children.",
      "India",
      "active",
      "PED-ADULT-3KG",
      "3kg bag",
      "3",
      "kg",
      "",
      "Adult",
      "Dog",
      "1850",
      "",
      "",
      "For adult dogs. 3kg pack.",
      "true",
      "https://example.com/images/pedigree-adult-3kg.jpg",
      "",
      "",
      "",
      "",
      "",
      "",
      "seed",
      "example-pedigree-adult-3kg",
      "Example row 5",
    ],
  ];

  const headerLine = headers.join(",");
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(","));
  return [headerLine, ...dataLines].join("\n");
}

function parseBulletPoints(raw: string | undefined | null): any | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Try JSON first
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr;
    } catch {
      // fall back to pipe split
    }
  }
  return trimmed.split("|").map((s) => s.trim()).filter(Boolean);
}

function normalizeStatus(status: string | undefined | null): boolean {
  if (!status) return true;
  const s = String(status).toLowerCase();
  if (s === "active") return true;
  if (s === "draft" || s === "inactive" || s === "disabled") return false;
  return true;
}

async function upsertBrandByName(name: string | undefined | null) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  const slug = slugify(trimmed);
  const existing = await prisma.brand.findFirst({
    where: { slug },
  });
  if (existing) return existing.id;
  const created = await prisma.brand.create({
    data: {
      name: trimmed,
      slug,
    },
  });
  return created.id;
}

async function upsertCompanyByName(name: string | undefined | null) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();

  const existing = await prisma.company.findFirst({
    where: { name: trimmed },
  });
  if (existing) return existing.id;

  const created = await prisma.company.create({
    data: {
      name: trimmed,
    },
  });
  return created.id;
}

async function upsertCategoryTree(categoryName: string | null, subcategoryName: string | null) {
  if (!categoryName || !categoryName.trim()) return { categoryId: null };
  const catName = categoryName.trim();
  const catSlug = slugify(catName);

  // Only find existing categories, do not create new ones
  // This prevents CSV imports from creating categories from product names
  let category = await prisma.category.findFirst({
    where: {
      parentId: null,
      OR: [
        { slug: catSlug },
        { name: { equals: catName, mode: "insensitive" } },
      ],
    },
  });

  if (!category) {
    throw new Error(`Category not found: "${catName}". Please use an existing category from the system.`);
  }

  if (!subcategoryName || !subcategoryName.trim()) {
    return { categoryId: category.id };
  }

  const subName = subcategoryName.trim();
  const subSlug = slugify(subName);
  let sub = await prisma.category.findFirst({
    where: {
      parentId: category.id,
      OR: [
        { slug: subSlug },
        { name: { equals: subName, mode: "insensitive" } },
      ],
    },
  });

  if (!sub) {
    throw new Error(`Subcategory "${subName}" not found under category "${catName}". Please use an existing subcategory.`);
  }

  return { categoryId: sub.id };
}

// Helper to safely get value from row with multiple possible keys
function getRowValue(row: any, ...keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
    // Also try case-insensitive lookup
    const foundKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== "") {
      return String(row[foundKey]).trim();
    }
  }
  return "";
}

function buildVariantFromRow(row: any) {
  const title = getRowValue(row, "variant_name", "variant name", "variant_title");
  if (!title) return null;

  const packSizeStr = getRowValue(row, "pack_size", "pack size", "size");
  const packSize = packSizeStr ? Number(packSizeStr) : null;
  
  const mrpStr = getRowValue(row, "mrp", "price", "mrp_price");
  const mrp = mrpStr ? Number(mrpStr) : null;
  
  const minPriceStr = getRowValue(row, "min_price", "min price");
  const minPrice = minPriceStr ? Number(minPriceStr) : null;
  
  const maxPriceStr = getRowValue(row, "max_price", "max price");
  const maxPrice = maxPriceStr ? Number(maxPriceStr) : null;
  
  const isDefaultStr = getRowValue(row, "is_default_variant", "is_default", "default");
  const isDefault = String(isDefaultStr).toLowerCase().trim() === "true";

  return {
    title,
    sku: getRowValue(row, "variant_sku", "sku", "variant sku") || undefined,
    unit: getRowValue(row, "pack_unit", "unit", "pack unit") || undefined,
    flavor: getRowValue(row, "flavour", "flavor") || undefined,
    packSize,
    packUnit: getRowValue(row, "pack_unit", "unit", "pack unit") || undefined,
    ageGroup: getRowValue(row, "age_group", "age group") || undefined,
    petType: getRowValue(row, "pet_type", "pet type") || undefined,
    mrp,
    minPrice,
    maxPrice,
    description: getRowValue(row, "variant_description", "variant description") || undefined,
    isDefault,
  };
}

/**
 * Upsert normalized MasterProductVariant row for a CSV record.
 * - Primary identifier: (masterId, variant_sku)
 * - Fallback: (masterId, variant_name, pack_size, pack_unit)
 */
async function upsertMasterVariantFromRow(masterId: number, row: any) {
  const title = getRowValue(row, "variant_name", "variant name", "variant_title");
  if (!title) return null;

  const packSizeStr = getRowValue(row, "pack_size", "pack size", "size");
  const packSize = packSizeStr ? Number(packSizeStr) : null;
  
  const packUnit = getRowValue(row, "pack_unit", "unit", "pack unit") || null;
  
  const mrpStr = getRowValue(row, "mrp", "price", "mrp_price");
  const mrp = mrpStr ? Number(mrpStr) : null;
  
  const minPriceStr = getRowValue(row, "min_price", "min price");
  const minPrice = minPriceStr ? Number(minPriceStr) : null;
  
  const maxPriceStr = getRowValue(row, "max_price", "max price");
  const maxPrice = maxPriceStr ? Number(maxPriceStr) : null;
  
  const isDefaultStr = getRowValue(row, "is_default_variant", "is_default", "default");
  const isDefault = String(isDefaultStr).toLowerCase().trim() === "true";

  const variantSku = getRowValue(row, "variant_sku", "sku", "variant sku") || null;
  const flavour = getRowValue(row, "flavour", "flavor") || null;
  const ageGroup = getRowValue(row, "age_group", "age group") || null;
  const petType = getRowValue(row, "pet_type", "pet type") || null;
  const variantDescription = getRowValue(row, "variant_description", "variant description") || null;

  let existing: any = null;

  if (variantSku) {
    existing = await prisma.masterProductVariant.findFirst({
      where: {
        masterId,
        variantSku,
      },
    });
  }

  if (!existing) {
    existing = await prisma.masterProductVariant.findFirst({
      where: {
        masterId,
        variantName: title,
        packSize: packSize,
        packUnit: packUnit,
      },
    });
  }

  const data: any = {
    masterId,
    variantSku,
    variantName: title,
    packSize,
    packUnit,
    flavour,
    ageGroup,
    petType,
    mrp,
    minPrice,
    maxPrice,
    variantDescription,
    isDefault,
  };

  if (!existing) {
    return prisma.masterProductVariant.create({ data });
  }

  return prisma.masterProductVariant.update({
    where: { id: existing.id },
    data,
  });
}

async function uploadImageFromUrl(url: string, ownerUserId: number, folder = "master-products") {
  const resp = await axios.get(url, { responseType: "arraybuffer" });
  const buffer = Buffer.from(resp.data);
  const mimeType = resp.headers["content-type"] || undefined;
  const originalname = url.split("/").pop() || "image";

  const media = await mediaService.uploadAndCreateMedia({
    ownerUserId,
    file: {
      buffer,
      mimetype: mimeType,
      originalname,
    },
    folder,
    type: "IMAGE",
  });

  return media;
}

async function attachPrimaryImageIfNeeded(masterId: number, row: any, ownerUserId: number) {
  const url = getRowValue(row, "primary_image_url", "image", "image_url", "primary_image");
  if (!url) return null;

  const master = await prisma.masterProductCatalog.findUnique({
    where: { id: masterId },
    select: { primaryMediaId: true },
  });
  if (master?.primaryMediaId) {
    return null;
  }

  try {
    const media = await uploadImageFromUrl(url, ownerUserId, "master-products");

    await prisma.masterProductCatalog.update({
      where: { id: masterId },
      data: {
        primaryMediaId: media.id,
      },
    });

    return media;
  } catch (e: any) {
    // Swallow image errors to keep import robust
    console.error("attachPrimaryImageIfNeeded error:", e.message || e);
    return null;
  }
}

async function attachGalleryImages(masterId: number, row: any, ownerUserId: number) {
  const urls: string[] = [];

  // Support up to 5 gallery image columns as per plan
  for (let i = 1; i <= 5; i++) {
    const keys = [
      `gallery_image_url_${i}`,
      `gallery_image_${i}`,
      `image_${i}`,
      `gallery_${i}`
    ];
    
    // Find first matching key
    let raw = "";
    for(const k of keys) {
      raw = getRowValue(row, k);
      if(raw) break;
    }
    
    if (raw) {
      urls.push(raw);
    }
  }

  if (!urls.length) return;

  try {
    const existingLinks = await prisma.masterProductMedia.findMany({
      where: { masterId },
      select: { mediaId: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });

    const existingMediaIds = new Set(existingLinks.map((l: any) => l.mediaId));
    let sortOrder =
      existingLinks.length > 0
        ? existingLinks[existingLinks.length - 1].sortOrder + 1
        : 0;

    for (const url of urls) {
      try {
        const media = await uploadImageFromUrl(url, ownerUserId, "master-products");

        if (existingMediaIds.has(media.id)) {
          continue;
        }

        await prisma.masterProductMedia.create({
          data: {
            masterId,
            mediaId: media.id,
            sortOrder,
          },
        });

        existingMediaIds.add(media.id);
        sortOrder += 1;
      } catch (e: any) {
        // Swallow individual image errors to keep import robust
        console.error(
          "attachGalleryImages single-image error:",
          e.message || e,
        );
      }
    }
  } catch (e: any) {
    // Swallow gallery-level errors to keep import robust
    console.error("attachGalleryImages error:", e.message || e);
  }
}

/**
 * Import Master Catalog rows from CSV buffer.
 * - dryRun=true performs validation only and returns a summary without writes.
 * - Supports flexible column headers (e.g. "Product Title" or "Title" or "product_title")
 */
async function importMasterCatalogFromCsv(params: {
  buffer: Buffer;
  dryRun?: boolean;
  createdByUserId: number;
}) {
  const { buffer, dryRun, createdByUserId } = params;

  const text = buffer.toString("utf-8");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true, // Handle Excel BOM
  });

  let rowIndex = 1; // header is row 1
  const summary = {
    rows: records.length,
    created: 0,
    updated: 0,
    errors: [] as Array<{ row: number; message: string }>,
  };

  for (const row of records) {
    rowIndex++;
    try {
      // Flexible header mapping
      const productTitle = getRowValue(row, "product_title", "title", "name", "product name", "product");
      const companyName = getRowValue(row, "company_name", "company", "manufacturer");
      const brandName = getRowValue(row, "brand_name", "brand");
      const categoryName = getRowValue(row, "category_name", "category");
      const subcategoryName = getRowValue(row, "subcategory_name", "subcategory", "sub_category");
      
      if (!productTitle) {
        throw new Error("product_title (or Name/Title) is required");
      }
      if (!brandName) {
        throw new Error("brand_name (or Brand) is required");
      }
      if (!categoryName) {
        throw new Error("category_name (or Category) is required");
      }

      if (dryRun) {
        // Only basic validation in dry run
        continue;
      }

      const companyId = companyName ? await upsertCompanyByName(companyName) : null;
      const brandId = await upsertBrandByName(brandName);
      const { categoryId } = await upsertCategoryTree(categoryName, subcategoryName || null);

      const statusVal = getRowValue(row, "status");
      const isActive = normalizeStatus(statusVal);
      
      const barcode = getRowValue(row, "global_sku", "barcode", "ean", "upc", "isbn") || undefined;
      
      const bulletPointsRaw = getRowValue(row, "bullet_points", "bullets", "features");
      const bulletPoints = parseBulletPoints(bulletPointsRaw);

      // Find existing master product
      let master = null;
      if (barcode) {
        master = await prisma.masterProductCatalog.findUnique({
          where: { barcode },
        });
      }
      if (!master) {
        master = await prisma.masterProductCatalog.findFirst({
          where: {
            name: productTitle,
            brandId: brandId ?? undefined,
          },
        });
      }

      const baseSlug = slugify(productTitle);
      const slugRaw = getRowValue(row, "product_slug", "slug");
      let slug = slugRaw || baseSlug;

      // Ensure unique slug
      if (!master) {
        let counter = 1;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const existingSlug = await prisma.masterProductCatalog.findUnique({
            where: { slug },
          });
          if (!existingSlug) break;
          slug = `${baseSlug}-${counter++}`;
        }
      }

      const variant = buildVariantFromRow(row);

      const productShortTitle = getRowValue(row, "product_short_title", "short_title", "short title");
      const shortDescription = getRowValue(row, "short_description", "short description");
      const description = getRowValue(row, "description", "long description");
      const usageInstructions = getRowValue(row, "usage_instructions", "usage");
      const storageInstructions = getRowValue(row, "storage_instructions", "storage");
      const safetyWarning = getRowValue(row, "safety_warning", "warning", "safety");
      const countryOfOrigin = getRowValue(row, "country_of_origin", "country", "origin");
      const primaryImageUrl = getRowValue(row, "primary_image_url", "image", "image_url", "primary_image");
      const externalSource = getRowValue(row, "external_source", "source");
      const externalProductId = getRowValue(row, "external_product_id", "external_id");

      if (!master) {
        // Create new master product
        const created = await prisma.masterProductCatalog.create({
          data: {
            name: productTitle,
            companyId: companyId ?? null,
            shortName: productShortTitle || null,
            slug,
            brandId: brandId ?? null,
            categoryId: categoryId ?? null,
            barcode: barcode || null,
            shortDescription: shortDescription || null,
            description: description || null,
            bulletPoints: bulletPoints,
            usageInstructions: usageInstructions || null,
            storageInstructions: storageInstructions || null,
            safetyWarning: safetyWarning || null,
            countryOfOrigin: countryOfOrigin || null,
            isActive,
            isVerified: false,
            variantsJson: variant ? [variant] : [],
            imageUrl: primaryImageUrl || null,
            sourceType: externalSource || null,
            sourceRef: externalProductId || null,
          },
        });

        summary.created++;
        if (variant) {
          await upsertMasterVariantFromRow(created.id, row);
        }
        await attachPrimaryImageIfNeeded(created.id, row, createdByUserId);
        await attachGalleryImages(created.id, row, createdByUserId);
      } else {
        // Merge variants
        let variants = (master.variantsJson as any) || [];
        if (variant) {
          const keySku = variant.sku;
          if (keySku) {
            const existingIndex = variants.findIndex(
              (v: any) => String(v.sku || "").trim() === keySku,
            );
            if (existingIndex >= 0) {
              variants[existingIndex] = {
                ...variants[existingIndex],
                ...variant,
              };
            } else {
              variants.push(variant);
            }
          } else {
            variants.push(variant);
          }
        }

        await prisma.masterProductCatalog.update({
          where: { id: master.id },
          data: {
            name: productTitle,
            companyId: companyId ?? master.companyId,
            shortName: productShortTitle || master.shortName,
            brandId: brandId ?? master.brandId,
            categoryId: categoryId ?? master.categoryId,
            barcode: barcode || master.barcode,
            shortDescription:
              shortDescription || master.shortDescription || null,
            description: description || master.description || null,
            bulletPoints: bulletPoints || master.bulletPoints,
            usageInstructions:
              usageInstructions || master.usageInstructions || null,
            storageInstructions:
              storageInstructions || master.storageInstructions || null,
            safetyWarning:
              safetyWarning || master.safetyWarning || null,
            countryOfOrigin:
              countryOfOrigin || master.countryOfOrigin || null,
            isActive,
            variantsJson: variants,
            imageUrl: master.imageUrl || primaryImageUrl || null,
            sourceType: master.sourceType || externalSource || null,
            sourceRef: master.sourceRef || externalProductId || null,
          },
        });

        summary.updated++;
        if (variant) {
          await upsertMasterVariantFromRow(master.id, row);
        }
        await attachPrimaryImageIfNeeded(master.id, row, createdByUserId);
        await attachGalleryImages(master.id, row, createdByUserId);
      }
    } catch (e: any) {
      summary.errors.push({
        row: rowIndex,
        message: e?.message || "Unknown error",
      });
    }
  }

  return summary;
}

/**
 * Get single master product by ID
 */
async function getMasterProductById(id: number) {
  const product = await prisma.masterProductCatalog.findUnique({
    where: { id },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          country: true,
          website: true,
        },
      },
      brand: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      variants: {
        orderBy: [
          { isDefault: "desc" },
          { id: "asc" },
        ],
      },
      primaryMedia: {
        select: {
          id: true,
          url: true,
          type: true,
          },
      },
      galleryMedia: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          sortOrder: true,
          media: {
            select: {
              id: true,
              url: true,
              type: true,
            },
          },
        },
      },
    },
  });

  if (!product) {
    throw new Error("Master product not found");
  }

  return product;
}

/**
 * Clone master product to organization
 * Creates a new Product in the organization with data from master catalog
 */
async function cloneMasterProduct(
  masterId: number,
  orgId: number,
  createdByUserId: number,
  options?: {
    branchId?: number;
    customVariants?: Array<{
      title: string;
      sku?: string;
      unit?: string;
      flavor?: string;
      barcode?: string;
      attributes?: any;
    }>;
    customPrices?: Record<string, number>; // variant title -> price
    customName?: string;
    customDescription?: string;
  }
) {
  // Idempotent: if org already has a product cloned from this master, return existing (caller will map to 409)
  const existingProduct = await prisma.product.findFirst({
    where: {
      orgId: orgId,
      masterCatalogId: masterId,
    },
    include: {
      org: { select: { id: true, name: true } },
      category: true,
      brand: true,
      variants: { orderBy: { createdAt: "asc" } },
      media: {
        orderBy: { sortOrder: "asc" },
        include: { media: { select: { id: true, url: true, type: true } } },
      },
    },
  });
  if (existingProduct) {
    const err = new Error("Already added to catalog");
    (err as any).alreadyAdded = true;
    (err as any).existingProduct = existingProduct;
    throw err;
  }

  // Get master product
  const masterProduct = await getMasterProductById(masterId);

  if (!masterProduct.isActive) {
    throw new Error("Master product is not active");
  }

  // Get units and flavors for variant creation
  const units = await prisma.unit.findMany();
  const flavors = await prisma.flavor.findMany();

  const unitMap: Record<string, number> = {};
  units.forEach((u: any) => {
    unitMap[u.code.toLowerCase()] = u.id;
  });

  const flavorMap: Record<string, number> = {};
  flavors.forEach((f: any) => {
    flavorMap[f.name.toLowerCase()] = f.id;
  });

  // Prepare product data
  const productName = options?.customName || masterProduct.name;
  const productDescription = options?.customDescription || masterProduct.description || undefined;
  const baseSlug = slugify(productName);
  let slug = baseSlug;
  let counter = 1;

  // Ensure unique slug within organization
  while (true) {
    const existing = await prisma.product.findFirst({
      where: {
        orgId: orgId,
        slug: slug,
      },
    });

    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  // Prepare variants
  let variantsToCreate: Array<{
    sku: string;
    title: string;
    attributes?: any;
    flavorId?: number;
    unitId?: number;
    barcode?: string;
  }> = [];

  if (options?.customVariants && options.customVariants.length > 0) {
    // Use custom variants
    variantsToCreate = options.customVariants.map((v, index) => {
      const sku = v.sku || `${slug.toUpperCase()}-${index + 1}`;
      const unitId = v.unit ? unitMap[v.unit.toLowerCase()] : undefined;
      const flavorId = v.flavor ? flavorMap[v.flavor.toLowerCase()] : undefined;

      return {
        sku: sku,
        title: v.title,
        attributes: v.attributes || {},
        flavorId: flavorId,
        unitId: unitId,
        barcode: v.barcode || undefined,
      };
    });
  } else {
    // Use master product variants (normalized first, then fall back to variantsJson)
    const variantsFromTable = Array.isArray((masterProduct as any).variants)
      ? ((masterProduct as any).variants as any[])
      : [];
    const variantsFromJson = Array.isArray((masterProduct as any).variantsJson)
      ? ((masterProduct as any).variantsJson as any[])
      : [];

    const masterVariants = variantsFromTable.length ? variantsFromTable : variantsFromJson;

    variantsToCreate = masterVariants.map((v: any, index: number) => {
      const unitCode = v.unit || v.packUnit;
      const flavorName = v.flavor || v.flavour;
      const sku =
        v.sku ||
        v.variantSku ||
        `${slug.toUpperCase()}-${index + 1}`;

      const unitId =
        v.unitId ||
        (unitCode ? unitMap[String(unitCode).toLowerCase()] : undefined);
      const flavorId =
        v.flavorId ||
        (flavorName ? flavorMap[String(flavorName).toLowerCase()] : undefined);

      const title =
        v.title ||
        v.variantName ||
        `${productName} ${unitCode || ""}`.trim();

      return {
        sku,
        title,
        attributes: {
          ...(unitCode && { unit: unitCode }),
          ...(flavorName && { flavor: flavorName }),
        },
        flavorId,
        unitId,
        barcode: v.barcode || v.variantSku || undefined,
      };
    });
  }

  // If no variants exist, create a default variant
  if (variantsToCreate.length === 0) {
    console.log(`[cloneMasterProduct] No variants found for master product ${masterId}, creating default variant`);
    variantsToCreate = [
      {
        sku: `${slug.toUpperCase()}-1`,
        title: productName,
        attributes: {},
      },
    ];
  }

  // Create product with variants
  const product = await prisma.product.create({
    data: {
      orgId: orgId,
      name: productName,
      slug: slug,
      status: "ACTIVE",
      categoryId: masterProduct.categoryId,
      brandId: masterProduct.brandId,
      description: productDescription,
      metaJson: masterProduct.metaJson,
      masterCatalogId: masterId,
      createdByUserId: createdByUserId,
      variants: {
        create: variantsToCreate.map((v) => ({
          sku: v.sku,
          title: v.title,
          attributes: v.attributes || {},
          flavorId: v.flavorId,
          unitId: v.unitId,
          barcode: v.barcode,
          isActive: true,
        })),
      },
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
      category: true,
      brand: true,
      variants: {
        orderBy: { createdAt: "asc" },
      },
      media: {
        orderBy: { sortOrder: "asc" },
        include: {
          media: { select: { id: true, url: true, type: true } },
        },
      },
    },
  });

  return product;
}

function normalizeBulletPointsInput(input: any): any | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (Array.isArray(input)) return input;
  return parseBulletPoints(String(input));
}

/**
 * Update a master product (admin/content team manual edits).
 */
async function updateMasterProduct(id: number, payload: any) {
  const data: any = {};

  if (payload.name !== undefined) data.name = payload.name;
  if (payload.shortName !== undefined) data.shortName = payload.shortName;
  if (payload.shortDescription !== undefined) data.shortDescription = payload.shortDescription;
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.companyId !== undefined) data.companyId = payload.companyId || null;
  if (payload.brandId !== undefined) data.brandId = payload.brandId || null;
  if (payload.categoryId !== undefined) data.categoryId = payload.categoryId || null;
  if (payload.usageInstructions !== undefined) data.usageInstructions = payload.usageInstructions;
  if (payload.storageInstructions !== undefined)
    data.storageInstructions = payload.storageInstructions;
  if (payload.safetyWarning !== undefined) data.safetyWarning = payload.safetyWarning;
  if (payload.countryOfOrigin !== undefined) data.countryOfOrigin = payload.countryOfOrigin;
  if (payload.metaTitle !== undefined) data.metaTitle = payload.metaTitle;
  if (payload.metaDescription !== undefined) data.metaDescription = payload.metaDescription;
  if (payload.isActive !== undefined) data.isActive = !!payload.isActive;
  if (payload.isVerified !== undefined) data.isVerified = !!payload.isVerified;

  const bp = normalizeBulletPointsInput(payload.bulletPoints);
  if (bp !== undefined) {
    data.bulletPoints = bp;
  }

  if (payload.variants !== undefined && Array.isArray(payload.variants)) {
    data.variantsJson = payload.variants;
  }

  const updated = await prisma.masterProductCatalog.update({
    where: { id },
    data,
    include: {
      company: {
        select: {
          id: true,
          name: true,
          country: true,
          website: true,
        },
      },
      brand: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      primaryMedia: {
        select: {
          id: true,
          url: true,
          type: true,
        },
      },
      galleryMedia: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          sortOrder: true,
          media: {
            select: {
              id: true,
              url: true,
              type: true,
            },
          },
        },
      },
    },
  });

  return updated;
}

module.exports = {
  getMasterProducts,
  getMasterProductById,
  cloneMasterProduct,
  generateMasterCatalogCsvTemplate,
  importMasterCatalogFromCsv,
  updateMasterProduct,
};

export {};
