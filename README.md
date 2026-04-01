# Waltzbot Mini App + Bot

Full setup for Telegram project **Waltzbot**:

- React Mini App (profiles, swipes, matches)
- Telegram bot (opens mini app from chat)

## Features

- Create and edit personal profile
- Swipe left/right (`Пропустить` / `Лайк`)
- Automatic matches when likes are mutual
- Telegram Mini App mode with fallback dev mode in browser

## Stack

- React + TypeScript + Vite
- Supabase (`profiles`, `swipes`, `matches`)
- Grammy (Telegram bot)

## Environment

Configured in `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- `TELEGRAM_BOT_TOKEN`
- `MINI_APP_URL`

`MINI_APP_URL` must be a public **HTTPS** URL (Telegram WebApp requirement).

## Supabase SQL

Run this in Supabase SQL editor:

```sql
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  telegram_id text unique not null,
  full_name text not null,
  gender text not null check (gender in ('male', 'female')),
  class_name text not null,
  height_cm int not null check (height_cm between 120 and 240),
  bio text not null,
  photo_url text,
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists photo_url text;

create table if not exists swipes (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references profiles(id) on delete cascade,
  to_profile_id uuid not null references profiles(id) on delete cascade,
  direction text not null check (direction in ('like', 'pass')),
  created_at timestamptz not null default now(),
  unique (from_profile_id, to_profile_id)
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  profile_a_id uuid not null references profiles(id) on delete cascade,
  profile_b_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_a_id, profile_b_id)
);

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

create policy "public read profile photos"
on storage.objects for select
using (bucket_id = 'profile-photos');

create policy "authenticated upload profile photos"
on storage.objects for insert
with check (bucket_id = 'profile-photos');
```

For quick MVP/testing, disable RLS on these tables or create policies that allow access for your app users.

## Run Everything

1. Install dependencies:

```bash
npm install
```

2. Run web + bot together:

```bash
npm run dev:all
```

Available scripts:

- `npm run dev:web` - only React mini app
- `npm run dev:bot` - only Telegram bot
- `npm run dev:all` - both together
- `npm run build` - production build for frontend

Bot commands:

- `/start` - sends welcome + button to open mini app
- `/app` - sends open mini app button
