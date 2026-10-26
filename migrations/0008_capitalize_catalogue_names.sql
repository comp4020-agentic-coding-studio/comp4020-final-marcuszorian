-- Sentence-cases the shop catalogue's display names, matching the
-- capitalization pass applied to the rest of the game's player-facing text.

UPDATE skins SET name = 'Coolant cyan'  WHERE id = 'cyan';
UPDATE skins SET name = 'Mint signal'   WHERE id = 'mint';
UPDATE skins SET name = 'Sodium orange' WHERE id = 'orange';
UPDATE skins SET name = 'Static pink'   WHERE id = 'pink';
UPDATE skins SET name = 'Violet hour'   WHERE id = 'violet';
UPDATE skins SET name = 'Gold standard' WHERE id = 'gold';
UPDATE skins SET name = 'Laser white'   WHERE id = 'laserCyan';

UPDATE tricks SET name = 'Tail whip'     WHERE id = 'tailwhip';
UPDATE tricks SET name = 'Superman'      WHERE id = 'superman';
UPDATE tricks SET name = 'Backflip'      WHERE id = 'backflip';
UPDATE tricks SET name = 'Barrel roll'   WHERE id = 'barrelroll';
UPDATE tricks SET name = 'Nightly spin'  WHERE id = 'nightlybig';
