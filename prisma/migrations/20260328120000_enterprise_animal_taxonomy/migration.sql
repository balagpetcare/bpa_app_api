-- Enterprise Animal Taxonomy: categories, types, breeds, sub-breeds, colors, coat patterns, sizes; Pet snapshot fields

-- CreateTable: animal_categories
CREATE TABLE "animal_categories" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "animal_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "animal_categories_code_key" ON "animal_categories"("code");

-- CreateTable: animal_sizes (before breeds reference it)
CREATE TABLE "animal_sizes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minWeightKg" DOUBLE PRECISION,
    "maxWeightKg" DOUBLE PRECISION,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "animal_sizes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "animal_sizes_code_key" ON "animal_sizes"("code");

-- CreateTable: animal_colors
CREATE TABLE "animal_colors" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hexPreview" VARCHAR(16),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "animal_colors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "animal_colors_code_key" ON "animal_colors"("code");

-- CreateTable: coat_patterns
CREATE TABLE "coat_patterns" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "coat_patterns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coat_patterns_code_key" ON "coat_patterns"("code");

-- AlterTable: animal_types - add category and taxonomy fields
ALTER TABLE "animal_types" ADD COLUMN "categoryId" INTEGER,
ADD COLUMN "code" TEXT,
ADD COLUMN "scientificName" VARCHAR(128),
ADD COLUMN "icon" VARCHAR(64),
ADD COLUMN "displayOrder" INTEGER DEFAULT 0,
ADD COLUMN "isActive" BOOLEAN DEFAULT true;

CREATE UNIQUE INDEX "animal_types_code_key" ON "animal_types"("code");

ALTER TABLE "animal_types" ADD CONSTRAINT "animal_types_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "animal_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: breeds - add taxonomy fields
ALTER TABLE "breeds" ADD COLUMN "code" VARCHAR(64),
ADD COLUMN "aliasNames" JSONB,
ADD COLUMN "originCountry" VARCHAR(64),
ADD COLUMN "defaultSizeId" INTEGER,
ADD COLUMN "isMixed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isOther" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "displayOrder" INTEGER DEFAULT 0,
ADD COLUMN "isActive" BOOLEAN DEFAULT true;

ALTER TABLE "breeds" ADD CONSTRAINT "breeds_defaultSizeId_fkey" FOREIGN KEY ("defaultSizeId") REFERENCES "animal_sizes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: sub_breeds
CREATE TABLE "sub_breeds" (
    "id" SERIAL NOT NULL,
    "breedId" INTEGER NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sub_breeds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sub_breeds_breedId_code_key" ON "sub_breeds"("breedId", "code");

ALTER TABLE "sub_breeds" ADD CONSTRAINT "sub_breeds_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "breeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: pets - add taxonomy FKs and snapshot fields
ALTER TABLE "pets" ADD COLUMN "subBreedId" INTEGER,
ADD COLUMN "colorId" INTEGER,
ADD COLUMN "coatPatternId" INTEGER,
ADD COLUMN "sizeId" INTEGER,
ADD COLUMN "animalTypeNameSnapshot" VARCHAR(128),
ADD COLUMN "breedNameSnapshot" VARCHAR(128),
ADD COLUMN "subBreedNameSnapshot" VARCHAR(128),
ADD COLUMN "colorNameSnapshot" VARCHAR(64),
ADD COLUMN "coatPatternNameSnapshot" VARCHAR(64),
ADD COLUMN "sizeNameSnapshot" VARCHAR(32),
ADD COLUMN "customBreedText" VARCHAR(256),
ADD COLUMN "customColorText" VARCHAR(128);

ALTER TABLE "pets" ADD CONSTRAINT "pets_subBreedId_fkey" FOREIGN KEY ("subBreedId") REFERENCES "sub_breeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pets" ADD CONSTRAINT "pets_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "animal_colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pets" ADD CONSTRAINT "pets_coatPatternId_fkey" FOREIGN KEY ("coatPatternId") REFERENCES "coat_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pets" ADD CONSTRAINT "pets_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "animal_sizes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
