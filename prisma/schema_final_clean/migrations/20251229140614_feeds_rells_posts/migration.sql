-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'REEL');

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "type" "PostType" NOT NULL DEFAULT 'TEXT',
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "posts_authorId_createdAt_idx" ON "posts"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "post_media_postId_idx" ON "post_media"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "post_media_postId_order_key" ON "post_media"("postId", "order");

-- CreateIndex
CREATE INDEX "post_likes_userId_idx" ON "post_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_likes_postId_userId_key" ON "post_likes"("postId", "userId");

-- CreateIndex
CREATE INDEX "post_comments_postId_createdAt_idx" ON "post_comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "post_comments_userId_idx" ON "post_comments"("userId");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
