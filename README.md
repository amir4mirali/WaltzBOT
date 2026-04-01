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
drop table if exists public.matches;
drop table if exists public.swipes;
drop table if exists public.profiles;

create table if not exists public.profiles (
  id bigint generated always as identity primary key,
  tg_id text not null unique,
  username text default '',
  first_name text default '',
  class_name text not null,
  gender text not null check (gender in ('male', 'female')),
  height_cm integer not null check (height_cm >= 120 and height_cm <= 230),
  bio text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.swipes (
  id bigint generated always as identity primary key,
  from_tg_id text not null,
  to_tg_id text not null,
  action text not null check (action in ('like', 'pass')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_tg_id, to_tg_id)
);

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  user_a text not null,
  user_b text not null,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

create index if not exists idx_profiles_active on public.profiles (is_active);
create index if not exists idx_swipes_from on public.swipes (from_tg_id);
create index if not exists idx_swipes_to on public.swipes (to_tg_id);
create index if not exists idx_matches_user_a on public.matches (user_a);
create index if not exists idx_matches_user_b on public.matches (user_b);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_swipes_updated_at on public.swipes;
create trigger trg_swipes_updated_at
before update on public.swipes
for each row execute function public.set_updated_at();

alter table public.profiles disable row level security;
alter table public.swipes disable row level security;
alter table public.matches disable row level security;
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
