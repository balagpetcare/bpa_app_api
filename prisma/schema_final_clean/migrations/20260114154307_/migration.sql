-- AddForeignKey
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
