-- MusicBrainz enrichment of the music catalog: release type, genres, tracklists and artists,
-- filled by scripts/music-backfill-musicbrainz.ts. Additive only. Apply before deploying the
-- code that reads it.
-- AlterTable
ALTER TABLE `MusicMetadata` ADD COLUMN `coverSource` VARCHAR(16) NULL,
    ADD COLUMN `enrichedAt` DATETIME(3) NULL,
    ADD COLUMN `firstReleaseDate` VARCHAR(10) NULL,
    ADD COLUMN `genres` JSON NULL,
    ADD COLUMN `mbReleaseId` VARCHAR(36) NULL,
    ADD COLUMN `mbTrackCount` INTEGER NULL,
    ADD COLUMN `primaryType` VARCHAR(16) NULL;

-- CreateTable
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
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicArtist` (
    `mbid` VARCHAR(36) NOT NULL,
    `name` VARCHAR(500) NOT NULL,
    `sortName` VARCHAR(500) NOT NULL,
    `enrichedAt` DATETIME(3) NULL,

    INDEX `MusicArtist_name_idx`(`name`),
    PRIMARY KEY (`mbid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

