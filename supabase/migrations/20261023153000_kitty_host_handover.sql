-- A host may offer the managing role to an existing member. The member must accept.
create table if not exists kitty_private.host_handover_offers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references kitty_private.groups(id),
  offered_by uuid not null references kitty_private.members(id),
  offered_to uuid not null references kitty_private.members(id),
  status text not null check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  check (offered_by <> offered_to)
);
create unique index if not exists one_pending_host_offer_per_member
  on kitty_private.host_handover_offers(group_id,offered_to) where status='pending';
create index if not exists host_offers_by_group on kitty_private.host_handover_offers(group_id,status,expires_at);
revoke all on kitty_private.host_handover_offers from public, anon, authenticated;
