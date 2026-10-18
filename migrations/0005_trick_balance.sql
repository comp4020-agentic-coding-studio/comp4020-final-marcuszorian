-- Longer tricks are dearer and need more inputs, and pay a higher bonus.
-- Rebalances the catalogue so bonus_metres grows with sequence length and cost.
-- The bonus is the distance a completed combo adds to the run (doc/adr/0013).

UPDATE tricks SET sequence = '["up","down"]',                    bonus_metres = 30  WHERE id = 'tailwhip';
UPDATE tricks SET sequence = '["up","left","right"]',            bonus_metres = 60  WHERE id = 'superman';
UPDATE tricks SET sequence = '["down","down","up","left"]',      bonus_metres = 110 WHERE id = 'backflip';
UPDATE tricks SET sequence = '["left","right","left","up"]',     bonus_metres = 170 WHERE id = 'barrelroll';
UPDATE tricks SET sequence = '["up","left","down","right"]',     bonus_metres = 240 WHERE id = 'nightlybig';
