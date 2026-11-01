-- "Remember my logins and settings across devices": one browser's synced
-- localStorage behind each verified provider login. Additive only. Apply before
-- deploying the code that reads it.
CREATE TABLE `BrowserState` (
    `service` VARCHAR(4) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `state` MEDIUMTEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`service`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
