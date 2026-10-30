CREATE TABLE `WorkSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `taskTitle` VARCHAR(255) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `done` BOOLEAN NOT NULL DEFAULT false,

    INDEX `WorkSession_userId_endedAt_idx`(`userId`, `endedAt`),
    INDEX `WorkSession_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkSession` ADD CONSTRAINT `WorkSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WorkSession` ADD CONSTRAINT `WorkSession_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
