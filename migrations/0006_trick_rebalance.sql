-- Rebalances trick bonuses: the free default now pays a real amount, and the
-- top catalogue entry tops out at 400m. Bonuses still rise with input count.
UPDATE tricks SET bonus_metres = 180 WHERE id = 'tailwhip';
UPDATE tricks SET bonus_metres = 230 WHERE id = 'superman';
UPDATE tricks SET bonus_metres = 290 WHERE id = 'backflip';
UPDATE tricks SET bonus_metres = 340 WHERE id = 'barrelroll';
UPDATE tricks SET bonus_metres = 400 WHERE id = 'nightlybig';
