-- Per-user music state for /api/music/me: saved albums, followed artists, liked tracks,
-- playlists, play history and the player state. Additive only. Apply before deploying the code that reads it.
CREATE TABLE `MusicSavedAlbum` (
    `userId` VARCHAR(16) NOT NULL,
    `mbid` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MusicSavedAlbum_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`userId`, `mbid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicFollowedArtist` (
    `userId` VARCHAR(16) NOT NULL,
    `artistMbid` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `artistMbid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicLike` (
    `userId` VARCHAR(16) NOT NULL,
    `hash` VARCHAR(40) NOT NULL,
    `fileId` INTEGER NOT NULL,
    `mbid` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MusicLike_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`userId`, `hash`, `fileId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicPlaylist` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MusicPlaylist_userId_updatedAt_idx`(`userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicPlaylistTrack` (
    `id` VARCHAR(191) NOT NULL,
    `playlistId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `hash` VARCHAR(40) NOT NULL,
    `fileId` INTEGER NOT NULL,
    `mbid` VARCHAR(36) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MusicPlaylistTrack_playlistId_position_idx`(`playlistId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicPlayHistory` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(16) NOT NULL,
    `hash` VARCHAR(40) NOT NULL,
    `fileId` INTEGER NOT NULL,
    `mbid` VARCHAR(36) NOT NULL,
    `playedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MusicPlayHistory_userId_playedAt_idx`(`userId`, `playedAt`),
    INDEX `MusicPlayHistory_mbid_playedAt_idx`(`mbid`, `playedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicPlayerState` (
    `userId` VARCHAR(16) NOT NULL,
    `state` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

