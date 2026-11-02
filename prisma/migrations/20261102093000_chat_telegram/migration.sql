CREATE TABLE `ChatTelegramCopy` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `telegramChatId` VARCHAR(32) NOT NULL,
    `telegramMessageId` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChatTelegramCopy_telegramChatId_telegramMessageId_key`(`telegramChatId`, `telegramMessageId`),
    INDEX `ChatTelegramCopy_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChatTelegramCopy` ADD CONSTRAINT `ChatTelegramCopy_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ChatMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
