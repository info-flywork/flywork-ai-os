-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'EMPLOYEE') NOT NULL,
    `mealOnly` BOOLEAN NOT NULL DEFAULT false,
    `approver` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `startedOn` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealMenu` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `note` TEXT NULL,
    `published` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MealMenu_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MealCategory_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealDish` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `slot` ENUM('MAIN', 'SOUP', 'SIDE', 'DESSERT') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `price` DECIMAL(12, 2) NULL,
    `choiceKey` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `photoKey` VARCHAR(191) NULL,
    `photoType` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MealDish_categoryId_active_idx`(`categoryId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealPhotoReview` (
    `id` VARCHAR(191) NOT NULL,
    `dishKey` VARCHAR(191) NOT NULL,
    `dishName` VARCHAR(191) NOT NULL,
    `decision` VARCHAR(191) NOT NULL,
    `imageUrl` TEXT NULL,
    `pageUrl` TEXT NULL,
    `decidedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MealPhotoReview_dishKey_key`(`dishKey`),
    INDEX `MealPhotoReview_decidedById_idx`(`decidedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealPhotoLink` (
    `id` VARCHAR(191) NOT NULL,
    `dishId` VARCHAR(191) NOT NULL,
    `list` VARCHAR(191) NOT NULL,
    `imageUrl` TEXT NULL,
    `pageUrl` TEXT NULL,
    `sources` JSON NOT NULL,
    `sourceSite` VARCHAR(191) NOT NULL,
    `rightsVerified` BOOLEAN NOT NULL DEFAULT false,
    `reason` TEXT NOT NULL,
    `sharedImage` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MealPhotoLink_dishId_key`(`dishId`),
    INDEX `MealPhotoLink_list_idx`(`list`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealMenuItem` (
    `id` VARCHAR(191) NOT NULL,
    `menuId` VARCHAR(191) NOT NULL,
    `dishId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `slot` ENUM('MAIN', 'SOUP', 'SIDE', 'DESSERT') NULL,
    `price` DECIMAL(12, 2) NULL,
    `choiceKey` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL,
    `available` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MealMenuItem_menuId_idx`(`menuId`),
    INDEX `MealMenuItem_dishId_idx`(`dishId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealOrder` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `menuId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `soupItemId` VARCHAR(191) NULL,
    `sideItemId` VARCHAR(191) NULL,
    `dessertItemId` VARCHAR(191) NULL,
    `absent` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `status` ENUM('RECEIVED', 'PREPARING', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'RECEIVED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MealOrder_menuId_status_idx`(`menuId`, `status`),
    INDEX `MealOrder_soupItemId_idx`(`soupItemId`),
    INDEX `MealOrder_sideItemId_idx`(`sideItemId`),
    INDEX `MealOrder_dessertItemId_idx`(`dessertItemId`),
    UNIQUE INDEX `MealOrder_userId_menuId_key`(`userId`, `menuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealGuestOrder` (
    `id` VARCHAR(191) NOT NULL,
    `menuId` VARCHAR(191) NOT NULL,
    `guestName` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `soupItemId` VARCHAR(191) NULL,
    `sideItemId` VARCHAR(191) NULL,
    `dessertItemId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MealGuestOrder_menuId_idx`(`menuId`),
    INDEX `MealGuestOrder_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealOrderAudit` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `guestOrderId` VARCHAR(191) NULL,
    `subjectUserId` VARCHAR(191) NULL,
    `subjectName` VARCHAR(191) NOT NULL,
    `changes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MealOrderAudit_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `MealOrderAudit_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveBalance` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `type` ENUM('ANNUAL', 'SICK', 'EXCUSE', 'UNPAID') NOT NULL,
    `allocatedDays` DECIMAL(6, 2) NOT NULL,
    `usedDays` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LeaveBalance_userId_year_type_key`(`userId`, `year`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveSettings` (
    `id` VARCHAR(191) NOT NULL,
    `hoursPerDay` DECIMAL(4, 2) NOT NULL,
    `weekendDays` JSON NOT NULL DEFAULT ('[]'),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveHoliday` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LeaveHoliday_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('ANNUAL', 'SICK', 'EXCUSE', 'UNPAID') NOT NULL,
    `duration` ENUM('FULL_DAY', 'MULTI_DAY', 'HOURLY') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `dayCount` DECIMAL(6, 2) NOT NULL,
    `hourCount` DECIMAL(6, 2) NULL,
    `reason` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `settlement` ENUM('OPEN', 'SALARY', 'ANNUAL') NOT NULL DEFAULT 'OPEN',
    `reviewNote` TEXT NULL,
    `balanceException` BOOLEAN NOT NULL DEFAULT false,
    `reviewerId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LeaveRequest_userId_status_idx`(`userId`, `status`),
    INDEX `LeaveRequest_startDate_endDate_idx`(`startDate`, `endDate`),
    INDEX `LeaveRequest_startsAt_endsAt_idx`(`startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveDocument` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `fileName` TEXT NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LeaveDocument_requestId_key`(`requestId`),
    UNIQUE INDEX `LeaveDocument_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveAudit` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` ENUM('REQUESTED', 'CANCELLED', 'APPROVED', 'REJECTED', 'REVERSED', 'BALANCE_SET', 'BALANCE_DEDUCTED', 'BALANCE_RESTORED', 'SALARY_SETTLED', 'ANNUAL_SETTLED') NOT NULL,
    `dayDelta` DECIMAL(6, 2) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeaveAudit_requestId_idx`(`requestId`),
    INDEX `LeaveAudit_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `scope` ENUM('EMPLOYEE', 'COMPANY', 'OFFICE') NOT NULL,
    `category` ENUM('TRANSPORT', 'MEAL', 'LODGING', 'SUPPLIES', 'SOFTWARE', 'SERVICE', 'SUBSCRIPTION', 'OPERATIONS', 'CLEANING', 'RENT', 'ELECTRICITY', 'INTERNET', 'EQUIPMENT', 'MARKET', 'WATER', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `title` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TRY',
    `paymentMethod` ENUM('CARD', 'TRANSFER', 'CASH', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `accountLabel` VARCHAR(191) NULL,
    `spentOn` DATE NOT NULL,
    `status` ENUM('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID') NOT NULL DEFAULT 'SUBMITTED',
    `reimbursement` ENUM('NOT_REQUIRED', 'PENDING', 'PAID') NOT NULL DEFAULT 'NOT_REQUIRED',
    `source` ENUM('MANUAL', 'UPLOAD') NOT NULL DEFAULT 'MANUAL',
    `note` TEXT NULL,
    `reviewNote` TEXT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `reviewerId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Expense_invoiceId_key`(`invoiceId`),
    INDEX `Expense_userId_scope_idx`(`userId`, `scope`),
    INDEX `Expense_scope_status_spentOn_idx`(`scope`, `status`, `spentOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseAudit` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `changes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExpenseAudit_expenseId_createdAt_idx`(`expenseId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseDocument` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `fileName` TEXT NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ExpenseDocument_expenseId_key`(`expenseId`),
    UNIQUE INDEX `ExpenseDocument_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `vendorKey` VARCHAR(191) NOT NULL,
    `scope` ENUM('EMPLOYEE', 'COMPANY', 'OFFICE') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TRY',
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `issuedOn` DATE NOT NULL,
    `dueOn` DATE NULL,
    `status` ENUM('ISSUED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
    `source` ENUM('MANUAL', 'UPLOAD') NOT NULL DEFAULT 'MANUAL',
    `tax` DECIMAL(12, 2) NULL,
    `note` TEXT NULL,
    `paymentMethod` ENUM('CARD', 'TRANSFER', 'CASH', 'OTHER') NULL,
    `accountLabel` VARCHAR(191) NULL,
    `spenderName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Invoice_issuedOn_scope_idx`(`issuedOn`, `scope`),
    UNIQUE INDEX `Invoice_vendorKey_number_key`(`vendorKey`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceDocument` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `fileName` TEXT NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `contentHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InvoiceDocument_invoiceId_key`(`invoiceId`),
    UNIQUE INDEX `InvoiceDocument_storageKey_key`(`storageKey`),
    UNIQUE INDEX `InvoiceDocument_contentHash_key`(`contentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceReview` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'HELD', 'REJECTED', 'APPROVED', 'DRIVE_FAILED') NOT NULL DEFAULT 'PENDING',
    `contentHash` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `fileName` TEXT NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `vendor` VARCHAR(191) NULL,
    `number` VARCHAR(191) NULL,
    `issuedOn` DATE NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(191) NULL,
    `tax` DECIMAL(12, 2) NULL,
    `documentType` ENUM('INVOICE', 'RECEIPT', 'NOT_INVOICE', 'UNKNOWN', 'STATEMENT') NOT NULL DEFAULT 'UNKNOWN',
    `missingFields` JSON NOT NULL DEFAULT ('[]'),
    `uncertainFields` JSON NOT NULL DEFAULT ('[]'),
    `aiSnapshot` JSON NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `driveFileId` VARCHAR(191) NULL,
    `driveError` TEXT NULL,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InvoiceReview_contentHash_key`(`contentHash`),
    UNIQUE INDEX `InvoiceReview_storageKey_key`(`storageKey`),
    UNIQUE INDEX `InvoiceReview_invoiceId_key`(`invoiceId`),
    INDEX `InvoiceReview_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceReviewAudit` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `corrections` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InvoiceReviewAudit_reviewId_createdAt_idx`(`reviewId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MealSettings` (
    `id` VARCHAR(191) NOT NULL,
    `opensAt` VARCHAR(191) NOT NULL,
    `closesAt` VARCHAR(191) NOT NULL,
    `weekdays` JSON NOT NULL DEFAULT ('[]'),
    `catererPhone` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TechnologySubscription` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `kind` ENUM('DOMAIN', 'SOFTWARE', 'HOSTING', 'API', 'SSL', 'OTHER') NOT NULL,
    `description` TEXT NULL,
    `project` VARCHAR(191) NULL,
    `ownerId` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `websiteUrl` TEXT NULL,
    `panelUrl` TEXT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TRY',
    `billingCycle` ENUM('MONTHLY', 'YEARLY', 'CUSTOM') NOT NULL,
    `customIntervalDays` INTEGER NULL,
    `renewsOn` DATE NOT NULL,
    `lastPaidOn` DATE NULL,
    `paymentMethod` ENUM('CARD', 'TRANSFER', 'CASH', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `cardLast4` VARCHAR(191) NULL,
    `autoRenew` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `domainName` VARCHAR(191) NULL,
    `registrar` VARCHAR(191) NULL,
    `domainExpiresOn` DATE NULL,
    `dnsProvider` VARCHAR(191) NULL,
    `sslIssuer` VARCHAR(191) NULL,
    `sslExpiresOn` DATE NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TechnologySubscription_active_renewsOn_idx`(`active`, `renewsOn`),
    INDEX `TechnologySubscription_status_kind_idx`(`status`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionRenewal` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `paidOn` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SubscriptionRenewal_expenseId_key`(`expenseId`),
    INDEX `SubscriptionRenewal_paidOn_idx`(`paidOn`),
    UNIQUE INDEX `SubscriptionRenewal_subscriptionId_periodEnd_key`(`subscriptionId`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionNotice` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `subject` ENUM('BILLING', 'DOMAIN', 'SSL') NOT NULL,
    `dueOn` DATE NOT NULL,
    `thresholdDays` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SubscriptionNotice_dueOn_idx`(`dueOn`),
    UNIQUE INDEX `notice_subject_due`(`subscriptionId`, `subject`, `dueOn`, `thresholdDays`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationJob` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `agent` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Europe/Istanbul',
    `weekdays` JSON NOT NULL DEFAULT ('[]'),
    `hour` INTEGER NOT NULL,
    `minute` INTEGER NOT NULL,
    `state` ENUM('ACTIVE', 'PAUSED', 'WAITING_CONNECTION') NOT NULL DEFAULT 'ACTIVE',
    `nextRunAt` DATETIME(3) NOT NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `lastStartedAt` DATETIME(3) NULL,
    `lastFinishedAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `maxRetries` INTEGER NOT NULL DEFAULT 3,
    `lockToken` VARCHAR(191) NULL,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AutomationJob_key_key`(`key`),
    INDEX `AutomationJob_state_nextRunAt_idx`(`state`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationRun` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `windowKey` VARCHAR(191) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `state` ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'WAITING_CONNECTION') NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `summary` TEXT NOT NULL,
    `report` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AutomationRun_startedAt_idx`(`startedAt`),
    UNIQUE INDEX `AutomationRun_jobId_windowKey_key`(`jobId`, `windowKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PanelAlertRead` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PanelAlertRead_userId_idx`(`userId`),
    UNIQUE INDEX `PanelAlertRead_userId_dedupeKey_key`(`userId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TelegramLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `telegramUserId` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `TelegramLink_userId_key`(`userId`),
    UNIQUE INDEX `TelegramLink_telegramUserId_key`(`telegramUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TelegramLinkRequest` (
    `id` VARCHAR(191) NOT NULL,
    `telegramUserId` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `status` ENUM('AWAITING_EMAIL', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,

    INDEX `TelegramLinkRequest_telegramUserId_status_idx`(`telegramUserId`, `status`),
    INDEX `TelegramLinkRequest_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TelegramPairingCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TelegramPairingCode_codeHash_key`(`codeHash`),
    INDEX `TelegramPairingCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TelegramUpdateReceipt` (
    `updateId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`updateId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TelegramDispatch` (
    `id` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TelegramDispatch_dedupeKey_key`(`dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PanelNotice` (
    `id` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'PANEL',
    `delivered` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PanelNotice_dedupeKey_key`(`dedupeKey`),
    INDEX `PanelNotice_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoogleAccount` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `email` VARCHAR(191) NOT NULL,
    `scopes` JSON NOT NULL DEFAULT ('[]'),
    `refreshTokenCipher` TEXT NOT NULL,
    `accessTokenCipher` TEXT NULL,
    `accessTokenExpiresAt` DATETIME(3) NULL,
    `status` ENUM('CONNECTED', 'ERROR') NOT NULL DEFAULT 'CONNECTED',
    `lastError` TEXT NULL,
    `connectedById` VARCHAR(191) NULL,
    `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GoogleAccount_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GmailProcessedItem` (
    `id` VARCHAR(191) NOT NULL,
    `gmailMessageId` VARCHAR(191) NOT NULL,
    `attachmentId` VARCHAR(191) NOT NULL DEFAULT '',
    `purpose` ENUM('ANALYSIS', 'INVOICE') NOT NULL,
    `threadId` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `driveFileId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GmailProcessedItem_purpose_createdAt_idx`(`purpose`, `createdAt`),
    UNIQUE INDEX `GmailProcessedItem_gmailMessageId_attachmentId_purpose_key`(`gmailMessageId`, `attachmentId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriveFolder` (
    `path` VARCHAR(512) NOT NULL,
    `driveId` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentActionRequest` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('GMAIL_SEND', 'GMAIL_DELETE') NOT NULL,
    `state` ENUM('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED') NOT NULL DEFAULT 'PENDING',
    `summary` TEXT NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgentActionRequest_state_createdAt_idx`(`state`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BonusCriterion` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `defaultAmount` DECIMAL(12, 2) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BonusCriterion_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BonusAward` (
    `id` VARCHAR(191) NOT NULL,
    `criterionId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `month` DATE NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paid` BOOLEAN NOT NULL DEFAULT false,
    `days` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BonusAward_month_idx`(`month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BonusRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `awardId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `BonusRecipient_awardId_userId_key`(`awardId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaidSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startedOn` DATE NULL,
    `lastPaidOn` DATE NULL,
    `cycle` ENUM('MONTHLY', 'YEARLY', 'USAGE') NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaidSubscription_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkSpace` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkSpace_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkTask` (
    `id` VARCHAR(191) NOT NULL,
    `spaceId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `detail` TEXT NULL,
    `column` ENUM('POOL', 'DOING', 'REVIEW', 'REVISION', 'DONE') NOT NULL DEFAULT 'POOL',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `startsOn` DATE NULL,
    `startsAt` VARCHAR(191) NULL,
    `endsAt` VARCHAR(191) NULL,
    `dueOn` DATE NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WorkTask_spaceId_column_sortOrder_idx`(`spaceId`, `column`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkTaskComment` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WorkTaskComment_taskId_createdAt_idx`(`taskId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkTaskMention` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `WorkTaskMention_commentId_userId_key`(`commentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkTaskLink` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `label` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkTaskImage` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkTaskImage_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedbackNote` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('SUGGESTION', 'COMPLAINT') NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('OPEN', 'REVIEWED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,

    INDEX `FeedbackNote_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `FeedbackNote_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkTaskAssignee` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `WorkTaskAssignee_taskId_userId_key`(`taskId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealDish` ADD CONSTRAINT `MealDish_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `MealCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealPhotoReview` ADD CONSTRAINT `MealPhotoReview_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealPhotoLink` ADD CONSTRAINT `MealPhotoLink_dishId_fkey` FOREIGN KEY (`dishId`) REFERENCES `MealDish`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealMenuItem` ADD CONSTRAINT `MealMenuItem_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `MealMenu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealMenuItem` ADD CONSTRAINT `MealMenuItem_dishId_fkey` FOREIGN KEY (`dishId`) REFERENCES `MealDish`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `MealMenu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_soupItemId_fkey` FOREIGN KEY (`soupItemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_sideItemId_fkey` FOREIGN KEY (`sideItemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrder` ADD CONSTRAINT `MealOrder_dessertItemId_fkey` FOREIGN KEY (`dessertItemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealGuestOrder` ADD CONSTRAINT `MealGuestOrder_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `MealMenu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealGuestOrder` ADD CONSTRAINT `MealGuestOrder_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealGuestOrder` ADD CONSTRAINT `MealGuestOrder_soupItemId_fkey` FOREIGN KEY (`soupItemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealGuestOrder` ADD CONSTRAINT `MealGuestOrder_sideItemId_fkey` FOREIGN KEY (`sideItemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealGuestOrder` ADD CONSTRAINT `MealGuestOrder_dessertItemId_fkey` FOREIGN KEY (`dessertItemId`) REFERENCES `MealMenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealGuestOrder` ADD CONSTRAINT `MealGuestOrder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MealOrderAudit` ADD CONSTRAINT `MealOrderAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveBalance` ADD CONSTRAINT `LeaveBalance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveDocument` ADD CONSTRAINT `LeaveDocument_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `LeaveRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveAudit` ADD CONSTRAINT `LeaveAudit_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `LeaveRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveAudit` ADD CONSTRAINT `LeaveAudit_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveAudit` ADD CONSTRAINT `LeaveAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseAudit` ADD CONSTRAINT `ExpenseAudit_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseAudit` ADD CONSTRAINT `ExpenseAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseDocument` ADD CONSTRAINT `ExpenseDocument_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceDocument` ADD CONSTRAINT `InvoiceDocument_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceReview` ADD CONSTRAINT `InvoiceReview_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceReviewAudit` ADD CONSTRAINT `InvoiceReviewAudit_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `InvoiceReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceReviewAudit` ADD CONSTRAINT `InvoiceReviewAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TechnologySubscription` ADD CONSTRAINT `TechnologySubscription_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionRenewal` ADD CONSTRAINT `SubscriptionRenewal_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `TechnologySubscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionRenewal` ADD CONSTRAINT `SubscriptionRenewal_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionNotice` ADD CONSTRAINT `SubscriptionNotice_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `TechnologySubscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationRun` ADD CONSTRAINT `AutomationRun_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `AutomationJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelAlertRead` ADD CONSTRAINT `PanelAlertRead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TelegramLink` ADD CONSTRAINT `TelegramLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TelegramLinkRequest` ADD CONSTRAINT `TelegramLinkRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TelegramPairingCode` ADD CONSTRAINT `TelegramPairingCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoogleAccount` ADD CONSTRAINT `GoogleAccount_connectedById_fkey` FOREIGN KEY (`connectedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentActionRequest` ADD CONSTRAINT `AgentActionRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BonusAward` ADD CONSTRAINT `BonusAward_criterionId_fkey` FOREIGN KEY (`criterionId`) REFERENCES `BonusCriterion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BonusRecipient` ADD CONSTRAINT `BonusRecipient_awardId_fkey` FOREIGN KEY (`awardId`) REFERENCES `BonusAward`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BonusRecipient` ADD CONSTRAINT `BonusRecipient_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTask` ADD CONSTRAINT `WorkTask_spaceId_fkey` FOREIGN KEY (`spaceId`) REFERENCES `WorkSpace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTask` ADD CONSTRAINT `WorkTask_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskComment` ADD CONSTRAINT `WorkTaskComment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskComment` ADD CONSTRAINT `WorkTaskComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskMention` ADD CONSTRAINT `WorkTaskMention_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `WorkTaskComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskMention` ADD CONSTRAINT `WorkTaskMention_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskLink` ADD CONSTRAINT `WorkTaskLink_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskImage` ADD CONSTRAINT `WorkTaskImage_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackNote` ADD CONSTRAINT `FeedbackNote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackNote` ADD CONSTRAINT `FeedbackNote_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskAssignee` ADD CONSTRAINT `WorkTaskAssignee_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `WorkTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkTaskAssignee` ADD CONSTRAINT `WorkTaskAssignee_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

