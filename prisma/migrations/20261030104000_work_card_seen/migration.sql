CREATE TABLE `WorkCardSeen` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `seenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkCardSeen_userId_taskId_key`(`userId`, `taskId`),
    INDEX `WorkCardSeen_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkCardSeen` ADD CONSTRAINT `WorkCardSeen_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkCardSeen` ADD CONSTRAINT `WorkCardSeen_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
