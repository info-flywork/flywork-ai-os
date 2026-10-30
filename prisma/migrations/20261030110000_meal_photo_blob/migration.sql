CREATE TABLE `MealPhotoBlob` (
    `storageKey` VARCHAR(64) NOT NULL,
    `bytes` LONGBLOB NOT NULL,

    PRIMARY KEY (`storageKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
