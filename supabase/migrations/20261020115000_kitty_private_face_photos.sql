-- Face photos are server-owned and never exposed through the Supabase Data API.
-- Kitty converts uploads to metadata-free WebP before storing a single photo
-- per member. Applications disclose it only to that group's eligible voters.
create table kitty_private.face_photos (
  owner_id uuid primary key references kitty_private.members(id),
  object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  content_type text not null default 'image/webp' check (content_type='image/webp'),
  content bytea not null check (octet_length(content) between 1 and 2097152),
  updated_at timestamptz not null default now()
);
alter table kitty_private.face_photos enable row level security;
revoke all on kitty_private.face_photos from public, anon, authenticated;
