-- Kitty dedicated database. No browser/Data API grants. Run only against Kitty's exact project.
create schema if not exists kitty_private;
create schema if not exists grasany_ops;
revoke all on schema kitty_private, grasany_ops from public, anon, authenticated;

create table kitty_private.members (
  id uuid primary key default gen_random_uuid(),
  grasany_subject text not null unique,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  adult_attested_at timestamptz not null,
  women_only_attested_at timestamptz not null,
  identity_status text not null default 'not_started' check (identity_status in ('not_started','pending','verified','rejected','expired','revoked')),
  identity_checked_at timestamptz,
  identity_expires_at timestamptz,
  identity_version text,
  identity_consent_version text,
  access_status text not null default 'not_started' check (access_status in ('not_started','pending','active','failed','revoked')),
  contact_text text,
  contact_consent_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (contact_text is null or length(contact_text) <= 160)
);

create table kitty_private.groups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  description text not null check (length(description) <= 500),
  public_city text not null check (length(public_city) <= 80),
  visibility text not null check (visibility in ('private','discoverable')),
  member_limit integer not null check (member_limit between 2 and 100),
  rules text not null default '' check (length(rules) <= 2000),
  created_by uuid not null references kitty_private.members(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table kitty_private.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  member_id uuid not null references kitty_private.members(id),
  role text not null check (role in ('host','member')),
  status text not null check (status in ('active','left','removed')),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
create unique index group_one_active_membership on kitty_private.group_memberships(group_id,member_id) where status='active';
create index memberships_by_member on kitty_private.group_memberships(member_id,status);

create table kitty_private.join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  member_id uuid not null references kitty_private.members(id),
  status text not null check (status in ('requested','waitlisted','approved','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references kitty_private.members(id)
);
create unique index one_open_request on kitty_private.join_requests(group_id,member_id) where status in ('requested','waitlisted');

create table kitty_private.invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  target_member_id uuid not null references kitty_private.members(id),
  invited_by uuid not null references kitty_private.members(id),
  status text not null check (status in ('pending','accepted','declined','revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table kitty_private.host_cycles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  cycle_number integer not null check (cycle_number > 0),
  status text not null check (status in ('active','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(group_id,cycle_number)
);
create unique index one_active_host_cycle on kitty_private.host_cycles(group_id) where status='active';

create table kitty_private.host_cycle_participants (
  cycle_id uuid not null references kitty_private.host_cycles(id),
  member_id uuid not null references kitty_private.members(id),
  joined_at timestamptz not null default now(),
  departed_at timestamptz,
  hosted_event_id uuid,
  exception_reason text check (length(exception_reason) <= 300),
  exception_approved_by uuid references kitty_private.members(id),
  exception_at timestamptz,
  primary key(cycle_id,member_id),
  check (not (hosted_event_id is not null and exception_reason is not null))
);

create table kitty_private.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  cycle_id uuid references kitty_private.host_cycles(id),
  host_member_id uuid not null references kitty_private.members(id),
  title text not null check (length(trim(title)) between 1 and 120),
  theme text not null default '' check (length(theme) <= 160),
  starts_at timestamptz not null,
  timezone text not null,
  private_location text not null default '' check (length(private_location) <= 300),
  private_reservation text not null default '' check (length(private_reservation) <= 500),
  scope text not null check (scope in ('group','open')),
  capacity integer not null check (capacity between 1 and 100),
  status text not null check (status in ('scheduled','completed','cancelled')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);
alter table kitty_private.host_cycle_participants add constraint hosted_event_fk foreign key(hosted_event_id) references kitty_private.events(id);
create index events_by_group_time on kitty_private.events(group_id,starts_at);

create table kitty_private.event_rsvps (
  event_id uuid not null references kitty_private.events(id),
  member_id uuid not null references kitty_private.members(id),
  response text not null check (response in ('going','maybe','not_going')),
  updated_at timestamptz not null default now(),
  primary key(event_id,member_id)
);

create table kitty_private.event_changes (
  event_id uuid not null references kitty_private.events(id),
  version integer not null,
  changed_by uuid not null references kitty_private.members(id),
  changed_at timestamptz not null default now(),
  changed_fields jsonb not null,
  primary key(event_id,version)
);

create table kitty_private.contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  member_id uuid not null references kitty_private.members(id),
  kind text not null check (kind in ('due','paid')),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000),
  currency text not null default 'INR' check (currency='INR'),
  note text not null default '' check (length(note) <= 300),
  recorded_by uuid not null references kitty_private.members(id),
  created_at timestamptz not null default now()
);

create table kitty_private.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  title text not null check (length(trim(title)) between 1 and 120),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000),
  currency text not null default 'INR' check (currency='INR'),
  paid_by uuid not null references kitty_private.members(id),
  created_by uuid not null references kitty_private.members(id),
  created_at timestamptz not null default now()
);
create table kitty_private.expense_splits (
  expense_id uuid not null references kitty_private.expenses(id),
  member_id uuid not null references kitty_private.members(id),
  amount_paise bigint not null check (amount_paise >= 0),
  primary key(expense_id,member_id)
);

create table kitty_private.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  from_member_id uuid not null references kitty_private.members(id),
  to_member_id uuid not null references kitty_private.members(id),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000),
  currency text not null default 'INR' check (currency='INR'),
  status text not null check (status in ('recorded','confirmed','disputed')),
  recorded_by uuid not null references kitty_private.members(id),
  confirmed_by uuid references kitty_private.members(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (from_member_id <> to_member_id)
);

create table kitty_private.reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  reporter_id uuid not null references kitty_private.members(id),
  target_id uuid not null references kitty_private.members(id),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved')),
  created_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);
create table kitty_private.blocks (
  actor_id uuid not null references kitty_private.members(id),
  target_id uuid not null references kitty_private.members(id),
  created_at timestamptz not null default now(),
  primary key(actor_id,target_id),
  check (actor_id <> target_id)
);

create table kitty_private.audit_log (
  id bigint generated always as identity primary key,
  group_id uuid references kitty_private.groups(id),
  actor_id uuid references kitty_private.members(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Product-local access is distinct from central identity and payment state.
create table kitty_private.onboarding_orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references kitty_private.members(id),
  amount_paise integer not null default 69900 check (amount_paise=69900),
  currency text not null default 'INR' check (currency='INR'),
  payment_status text not null default 'not_started' check (payment_status in ('not_started','pending','paid','failed','refunded')),
  provider_order_id text unique,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table grasany_ops.heartbeat (
  product_id text primary key check (product_id='kitty'),
  counter bigint not null default 0 check (counter>=0),
  last_probe_id uuid,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
insert into grasany_ops.heartbeat(product_id) values ('kitty') on conflict do nothing;
create table grasany_ops.heartbeat_nonce (
  nonce uuid primary key,
  expires_at timestamptz not null
);
create index heartbeat_nonce_expiry on grasany_ops.heartbeat_nonce(expires_at);

do $$ declare item record; begin
  for item in select schemaname,tablename from pg_tables where schemaname in ('kitty_private','grasany_ops') loop
    execute format('alter table %I.%I enable row level security',item.schemaname,item.tablename);
    execute format('revoke all on %I.%I from public, anon, authenticated',item.schemaname,item.tablename);
  end loop;
end $$;
revoke all on all sequences in schema kitty_private,grasany_ops from public,anon,authenticated;
