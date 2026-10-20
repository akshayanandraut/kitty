-- Private reviewer profiles. A photo key is an opaque reference in a private
-- bucket; neither this table nor the bucket receives browser role grants.
alter table kitty_private.members
  add column profile_bio text not null default '' check (length(profile_bio) <= 500),
  add column instagram_handle text check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._-]{1,40}$'),
  add column facebook_handle text check (facebook_handle is null or facebook_handle ~ '^[A-Za-z0-9._-]{1,40}$'),
  add column snapchat_handle text check (snapchat_handle is null or snapchat_handle ~ '^[A-Za-z0-9._-]{1,40}$'),
  add column face_photo_key text unique check (face_photo_key is null or face_photo_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  add column whatsapp_e164 text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column whatsapp_verified_at timestamptz,
  add column whatsapp_verification_source text check (whatsapp_verification_source is null or length(whatsapp_verification_source) <= 80),
  add constraint verified_whatsapp_has_number check (whatsapp_verified_at is null or (whatsapp_e164 is not null and whatsapp_verification_source is not null));

-- Monthly figure is descriptive, not a recurring charge. Split basis is chosen
-- when the group is created and displayed before joining.
alter table kitty_private.groups
  add column avg_monthly_cost_paise integer not null default 0 check (avg_monthly_cost_paise between 0 and 1000000000),
  add column expense_split_basis text not null default 'members' check (expense_split_basis in ('members','attendees'));

alter table kitty_private.join_requests
  add column profile_share_consent_at timestamptz,
  add column review_profile jsonb,
  add column reapply_after timestamptz,
  add column override_by uuid references kitty_private.members(id),
  add column override_reason text check (override_reason is null or length(trim(override_reason)) between 1 and 300),
  add column override_at timestamptz,
  add constraint open_review_profile_only check (review_profile is null or status in ('requested','waitlisted'));
create index join_cooldown_by_group_member on kitty_private.join_requests(group_id,member_id,reapply_after desc) where status='declined';

create table kitty_private.join_vote_electorate (
  request_id uuid not null references kitty_private.join_requests(id),
  voter_id uuid not null references kitty_private.members(id),
  snapshotted_at timestamptz not null default now(),
  primary key(request_id,voter_id)
);
create table kitty_private.join_votes (
  request_id uuid not null,
  voter_id uuid not null,
  approve boolean not null,
  voted_at timestamptz not null default now(),
  primary key(request_id,voter_id),
  foreign key (request_id,voter_id) references kitty_private.join_vote_electorate(request_id,voter_id)
);

alter table kitty_private.expenses
  add column event_id uuid references kitty_private.events(id),
  add column split_basis text not null default 'members' check (split_basis in ('members','attendees')),
  add column status text not null default 'proposed' check (status in ('proposed','agreed','disputed','void')),
  add column agreed_at timestamptz;
create table kitty_private.expense_approvals (
  expense_id uuid not null,
  member_id uuid not null,
  approved_at timestamptz not null default now(),
  primary key(expense_id,member_id),
  foreign key (expense_id,member_id) references kitty_private.expense_splits(expense_id,member_id)
);

-- Private object bucket. There are deliberately no storage.objects policies for
-- anon or authenticated: Kitty sessions are product-local server cookies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('kitty-profile-photos','kitty-profile-photos',false,2097152,array['image/jpeg','image/webp'])
on conflict (id) do nothing;

do $$ declare item text; begin
  foreach item in array array['join_vote_electorate','join_votes','expense_approvals'] loop
    execute format('alter table kitty_private.%I enable row level security',item);
    execute format('revoke all on kitty_private.%I from public, anon, authenticated',item);
  end loop;
end $$;
