-- Closed matchdays keep the scoring position and tier each attending player had, so later changes leave their
-- scores alone. Days closed before this keep the values in effect now; unset ones default as scoringOf does.
UPDATE club SET data=json_set(data,'$.days',json(COALESCE((
 SELECT json_group_array(json(CASE WHEN json_extract(d.value,'$.poll')='closed' AND json_type(d.value,'$.scoring') IS NULL
  THEN json_set(d.value,'$.scoring',json(COALESCE((
   SELECT json_group_object(json_extract(r.value,'$.id'),json_object(
    'position',COALESCE(json_extract(p.value,'$.scoringPosition'),CASE WHEN json_extract(p.value,'$.position') IN ('Goalkeeper','Defender','Midfielder','Forward') THEN json_extract(p.value,'$.position') ELSE 'Midfielder' END),
    'tier',COALESCE(json_extract(p.value,'$.tier'),3)))
   FROM json_each(d.value,'$.roster') r JOIN json_each(club.data,'$.players') p ON json_extract(p.value,'$.id')=json_extract(r.value,'$.id')
  ),'{}')))
  ELSE d.value END))
 FROM json_each(club.data,'$.days') d
),'[]'))),revision=revision+1 WHERE id=1;
