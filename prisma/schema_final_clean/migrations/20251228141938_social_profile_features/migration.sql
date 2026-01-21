-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "user_profile_likes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "likedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profile_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_friend_requests" (
    "id" SERIAL NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_friend_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_friends" (
    "id" SERIAL NOT NULL,
    "userAId" INTEGER NOT NULL,
    "userBId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_friends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_profile_likes_userId_idx" ON "user_profile_likes"("userId");

-- CreateIndex
CREATE INDEX "user_profile_likes_likedById_idx" ON "user_profile_likes"("likedById");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_likes_userId_likedById_key" ON "user_profile_likes"("userId", "likedById");

-- CreateIndex
CREATE INDEX "user_friend_requests_toUserId_idx" ON "user_friend_requests"("toUserId");

-- CreateIndex
CREATE INDEX "user_friend_requests_fromUserId_idx" ON "user_friend_requests"("fromUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_friend_requests_fromUserId_toUserId_key" ON "user_friend_requests"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "user_friends_userAId_idx" ON "user_friends"("userAId");

-- CreateIndex
CREATE INDEX "user_friends_userBId_idx" ON "user_friends"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "user_friends_userAId_userBId_key" ON "user_friends"("userAId", "userBId");

-- AddForeignKey
ALTER TABLE "user_profile_likes" ADD CONSTRAINT "user_profile_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile_likes" ADD CONSTRAINT "user_profile_likes_likedById_fkey" FOREIGN KEY ("likedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friend_requests" ADD CONSTRAINT "user_friend_requests_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friend_requests" ADD CONSTRAINT "user_friend_requests_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friends" ADD CONSTRAINT "user_friends_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friends" ADD CONSTRAINT "user_friends_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
