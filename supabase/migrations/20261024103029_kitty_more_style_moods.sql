alter table kitty_private.groups drop constraint if exists groups_style_tags_check;
alter table kitty_private.groups add constraint groups_style_tags_check
  check (cardinality(style_tags) <= 3 and style_tags <@ array[
    'saree','western','party','beach','active','modest','hijab',
    'burkha','rida','swimwear','sweet','glam','bold','casual'
  ]::text[]);
