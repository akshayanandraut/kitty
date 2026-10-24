-- A group advertises its own audience and outfit mood. We never store a
-- member's religion or orientation as an account/profile attribute.
alter table kitty_private.groups
  add column faith_focus text not null default 'any'
    check (faith_focus in ('any','hindu','muslim','christian','catholic','sikh','jain','buddhist','other')),
  add column community_space text not null default 'all'
    check (community_space in ('all','lesbian','lgbtq')),
  add column region_focus text not null default 'any'
    check (region_focus in ('any','north_india','south_india','east_india','west_india','central_india','northeast_india','northwest_india','southeast_india','southwest_india','punjabi','assamese','other')),
  add column style_tags text[] not null default '{}'::text[]
    check (cardinality(style_tags) <= 3 and style_tags <@ array['saree','western','party','beach','active','modest','hijab','bold','casual']::text[]);

alter table kitty_private.join_requests
  add column audience_confirmed_at timestamptz;

-- Existing names can be reviewed separately. New or updated names cannot use
-- common religion names; community labels live in the explicit audience fields.
alter table kitty_private.groups add constraint group_title_without_religion
  check (title !~* '(^|[^[:alpha:]])(hindu(ism|s)?|muslim(s)?|islam(ic)?|christian(ity|s)?|catholic(s)?|sikh(ism|s)?|jain(ism|s)?|buddhist(s)?|buddhism|jew(ish|s)?|parsi(s)?|zoroastrian(s)?)([^[:alpha:]]|$)'
    and title !~* '(हिंदू|हिन्दू|मुस्लिम|इस्लाम|सिख|जैन|बौद्ध|ईसाई)') not valid;

create index groups_public_affinity on kitty_private.groups(faith_focus,community_space,created_at desc)
  where visibility='discoverable' and deleted_at is null;
create index groups_public_region on kitty_private.groups(region_focus,created_at desc)
  where visibility='discoverable' and deleted_at is null;
create index groups_public_styles on kitty_private.groups using gin(style_tags)
  where visibility='discoverable' and deleted_at is null;
