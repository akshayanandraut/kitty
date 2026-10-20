-- Public discovery uses an optional, approximate area pin. Never put a venue or
-- a member's location in these fields; coordinates are quantized in the API.
alter table kitty_private.groups
  add column public_area text not null default '' check (length(public_area) <= 80),
  add column public_latitude numeric(5,2) check (public_latitude between -90 and 90),
  add column public_longitude numeric(5,2) check (public_longitude between -180 and 180),
  add constraint public_pin_pair check ((public_latitude is null) = (public_longitude is null));
create index groups_discoverable_location on kitty_private.groups(public_latitude,public_longitude)
  where visibility='discoverable' and deleted_at is null and public_latitude is not null;

-- Bishi is a gated record-keeping capability. No browser/Data API role gets
-- table access. A distinct, group-specific authorization must be recorded by
-- an operator after legal review before an API can activate real-money rounds.
create table kitty_private.bishi_authorizations (
  group_id uuid primary key references kitty_private.groups(id),
  jurisdiction text not null check (length(trim(jurisdiction)) between 2 and 80),
  authorization_reference text not null check (length(trim(authorization_reference)) between 3 and 160),
  authorization_type text not null check (authorization_type in ('registered_chit','legal_exemption')),
  valid_until date not null,
  recorded_at timestamptz not null default now(),
  check (valid_until > recorded_at::date)
);
create table kitty_private.bishi_plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  amount_paise bigint not null check (amount_paise between 100 and 1000000000),
  cadence text not null check (cadence in ('weekly','fortnightly','monthly')),
  starts_on date not null,
  status text not null default 'proposed' check (status in ('proposed','active','completed','cancelled')),
  created_by uuid not null references kitty_private.members(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  check ((status='active' and activated_at is not null) or status<>'active')
);
create unique index one_open_bishi_plan on kitty_private.bishi_plans(group_id)
  where status in ('proposed','active');
create table kitty_private.bishi_participants (
  plan_id uuid not null references kitty_private.bishi_plans(id),
  member_id uuid not null references kitty_private.members(id),
  consented_at timestamptz,
  joined_at timestamptz,
  primary key(plan_id,member_id)
);
create table kitty_private.bishi_rounds (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references kitty_private.bishi_plans(id),
  round_number integer not null check (round_number between 1 and 100),
  scheduled_for date not null,
  status text not null default 'planned' check (status in ('planned','drawn','cancelled')),
  seed_commitment text not null check (seed_commitment ~ '^[0-9a-f]{64}$'),
  seed_secret text not null check (seed_secret ~ '^[0-9a-f]{64}$'),
  winner_member_id uuid references kitty_private.members(id),
  drawn_at timestamptz,
  unique(plan_id,round_number),
  check ((status='drawn') = (winner_member_id is not null and drawn_at is not null))
);
create table kitty_private.bishi_contributions (
  round_id uuid not null references kitty_private.bishi_rounds(id),
  member_id uuid not null references kitty_private.members(id),
  amount_paise bigint not null check (amount_paise between 100 and 1000000000),
  reported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references kitty_private.members(id),
  primary key(round_id,member_id),
  check ((confirmed_at is null and confirmed_by is null) or
         (confirmed_at is not null and confirmed_by is not null and reported_at is not null and confirmed_by<>member_id))
);
create table kitty_private.bishi_payouts (
  round_id uuid primary key references kitty_private.bishi_rounds(id),
  winner_member_id uuid not null references kitty_private.members(id),
  reported_amount_paise bigint not null check (reported_amount_paise between 100 and 100000000000),
  reported_at timestamptz not null default now(),
  recipient_confirmed_at timestamptz
);
create index bishi_rounds_by_plan on kitty_private.bishi_rounds(plan_id,round_number);

do $$ declare item text; begin
  foreach item in array array['bishi_authorizations','bishi_plans','bishi_participants','bishi_rounds','bishi_contributions','bishi_payouts'] loop
    execute format('alter table kitty_private.%I enable row level security', item);
    execute format('alter table kitty_private.%I force row level security', item);
    execute format('revoke all on kitty_private.%I from public, anon, authenticated', item);
  end loop;
end $$;
