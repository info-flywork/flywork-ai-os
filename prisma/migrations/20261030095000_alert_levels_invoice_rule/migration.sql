ALTER TABLE `WorkTaskAssignee`
  ADD COLUMN `assignedAt` DATETIME(3) NOT NULL DEFAULT '2000-01-01 00:00:00.000';

CREATE TABLE `InvoiceAutoRule` (
  `id` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `maxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'TRY',
  `vendors` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `InvoiceAutoRule` (`id`, `enabled`, `maxAmount`, `currency`, `vendors`, `updatedAt`)
VALUES ('default', false, 0, 'TRY', JSON_ARRAY(), CURRENT_TIMESTAMP(3));
