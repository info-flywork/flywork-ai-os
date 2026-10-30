CREATE TABLE `WorkCommentReaction` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkCommentReaction_commentId_userId_emoji_key`(`commentId`, `userId`, `emoji`),
    INDEX `WorkCommentReaction_commentId_idx`(`commentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkCommentReaction` ADD CONSTRAINT `WorkCommentReaction_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `WorkTaskComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkCommentReaction` ADD CONSTRAINT `WorkCommentReaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
