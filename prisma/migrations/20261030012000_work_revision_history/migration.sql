ALTER TABLE `WorkTask` ADD COLUMN `revisionCount` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `WorkTask` ADD COLUMN `enforced` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `WorkRevisionItem` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `body` VARCHAR(300) NOT NULL,
    `done` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WorkRevisionItem_taskId_sortOrder_idx`(`taskId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkTaskMove` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `column` ENUM('POOL', 'DOING', 'REVIEW', 'REVISION', 'DONE') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WorkTaskMove_taskId_createdAt_idx`(`taskId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkRevisionItem` ADD CONSTRAINT `WorkRevisionItem_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkTaskMove` ADD CONSTRAINT `WorkTaskMove_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkTaskMove` ADD CONSTRAINT `WorkTaskMove_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
