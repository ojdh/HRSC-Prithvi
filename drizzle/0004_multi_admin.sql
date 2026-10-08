-- Clubs saved before multiple admins existed start with no extra admins; the owner (adminId) keeps full rights.
UPDATE club SET data=json_set(data,'$.admins',json('[]')),revision=revision+1 WHERE id=1 AND json_type(data,'$.admins') IS NULL;
