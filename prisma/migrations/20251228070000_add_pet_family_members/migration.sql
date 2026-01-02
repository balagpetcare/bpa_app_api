-- CreateEnum
CREATE TYPE "FamilyRelation" AS ENUM ('OWNER', 'DAD', 'MOM', 'BROTHER', 'SISTER', 'OTHER');

-- CreateTable
CREATE TABLE "pet_family_members" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "relation" "FamilyRelation" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "avatarMediaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_family_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_family_members_petId_idx" ON "pet_family_members"("petId");

-- AddForeignKey
ALTER TABLE "pet_family_members" ADD CONSTRAINT "pet_family_members_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_family_members" ADD CONSTRAINT "pet_family_members_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
