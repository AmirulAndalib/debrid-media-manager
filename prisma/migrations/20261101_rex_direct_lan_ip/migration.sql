-- rex-direct LAN names: the private IP each server's `lan.<hash>` record points at.
-- Additive only.
ALTER TABLE `RexDirectName`
    ADD COLUMN `lastLanIp` VARCHAR(64) NULL;
