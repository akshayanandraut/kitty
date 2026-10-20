-- Server-only OIDC authorization and local session state.
-- Self-attestation is recorded after central sign-in, before any member access.
alter table kitty_private.members alter column adult_attested_at drop not null;
alter table kitty_private.members alter column women_only_attested_at drop not null;

create table kitty_private.auth_flows (
  state_hash text primary key,
  pkce_verifier text not null,
  nonce text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_flows_expiry on kitty_private.auth_flows(expires_at);

create table kitty_private.sessions (
  token_hash text primary key,
  member_id uuid not null references kitty_private.members(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index sessions_by_member on kitty_private.sessions(member_id, expires_at);
create index sessions_expiry on kitty_private.sessions(expires_at);

alter table kitty_private.auth_flows enable row level security;
alter table kitty_private.sessions enable row level security;
revoke all on kitty_private.auth_flows, kitty_private.sessions from public, anon, authenticated;
