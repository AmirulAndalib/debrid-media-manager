-- The music tables as prisma/schema.prisma declares them, from
-- `prisma migrate diff --from-empty --to-schema-datamodel` on 2026-11-01 (with the
-- 20261101_add_music_metadata columns); dmmdb's own DDL was not read. Statements are
-- separated by a line holding only ";".
CREATE TABLE `MusicMetadata` (
    `mbid` VARCHAR(36) NOT NULL,
    `artistMbid` VARCHAR(36) NULL,
    `artist` VARCHAR(500) NOT NULL,
    `album` VARCHAR(500) NOT NULL,
    `year` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `coverUrl` VARCHAR(500) NULL,
    `primaryType` VARCHAR(16) NULL,
    `genres` JSON NULL,
    `firstReleaseDate` VARCHAR(10) NULL,
    `mbTrackCount` INTEGER NULL,
    `mbReleaseId` VARCHAR(36) NULL,
    `coverSource` VARCHAR(16) NULL,
    `enrichedAt` DATETIME(3) NULL,

    INDEX `MusicMetadata_artist_idx`(`artist`),
    INDEX `MusicMetadata_year_idx`(`year`),
    FULLTEXT INDEX `MusicMetadata_artist_album_idx`(`artist`, `album`),
    PRIMARY KEY (`mbid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;

CREATE TABLE `AvailableMusic` (
    `hash` VARCHAR(191) NOT NULL,
    `mbid` VARCHAR(36) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `originalFilename` VARCHAR(191) NOT NULL,
    `bytes` BIGINT NOT NULL,
    `originalBytes` BIGINT NOT NULL,
    `host` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `ended` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AvailableMusic_status_idx`(`status`),
    INDEX `AvailableMusic_mbid_idx`(`mbid`),
    INDEX `AvailableMusic_mbid_hash_idx`(`mbid`, `hash`),
    INDEX `AvailableMusic_mbid_status_bytes_idx`(`mbid`, `status`, `bytes`),
    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;

CREATE TABLE `AvailableMusicFile` (
    `link` VARCHAR(191) NOT NULL,
    `file_id` INTEGER NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `path` TEXT NOT NULL,
    `bytes` BIGINT NOT NULL,
    `trackNumber` INTEGER NULL,

    INDEX `AvailableMusicFile_hash_idx`(`hash`),
    PRIMARY KEY (`link`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;

CREATE TABLE `MusicTrackMetadata` (
    `mbid` VARCHAR(36) NOT NULL,
    `disc` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `lengthMs` INTEGER NULL,
    `recordingMbid` VARCHAR(36) NOT NULL,
    `artist` VARCHAR(500) NULL,

    INDEX `MusicTrackMetadata_recordingMbid_idx`(`recordingMbid`),
    FULLTEXT INDEX `MusicTrackMetadata_title_idx`(`title`),
    PRIMARY KEY (`mbid`, `disc`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;

CREATE TABLE `MusicArtist` (
    `mbid` VARCHAR(36) NOT NULL,
    `name` VARCHAR(500) NOT NULL,
    `sortName` VARCHAR(500) NOT NULL,
    `enrichedAt` DATETIME(3) NULL,

    INDEX `MusicArtist_name_idx`(`name`),
    PRIMARY KEY (`mbid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;

