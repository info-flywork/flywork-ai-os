CREATE TABLE `WorkCommentImage` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkCommentImage_storageKey_key`(`storageKey`),
    INDEX `WorkCommentImage_commentId_idx`(`commentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkCommentImage` ADD CONSTRAINT `WorkCommentImage_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `WorkTaskComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
