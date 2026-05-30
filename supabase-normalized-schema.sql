-- MedQuest granular sync schema.
-- Run this in the Supabase SQL editor after the Supabase connection is stable.

create table if not exists public.mq_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  pergunta text,
  resposta text,
  html_front text,
  html_back text,
  tags text,
  due_at timestamptz,
  review_level integer not null default 0,
  correct_count integer not null default 0,
  site_reps integer not null default 0,
  review_correct integer not null default 0,
  review_wrong integer not null default 0,
  suspended boolean not null default false,
  deleted boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table if not exists public.mq_review_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  grade text not null,
  percent integer not null default 0,
  correct boolean not null default false,
  seconds integer not null default 0,
  answered_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists mq_cards_user_due_idx
  on public.mq_cards (user_id, due_at, review_level);

create index if not exists mq_review_events_user_card_idx
  on public.mq_review_events (user_id, card_id, answered_at desc);

alter table public.mq_cards enable row level security;
alter table public.mq_review_events enable row level security;

drop policy if exists "Users manage their own cards" on public.mq_cards;
create policy "Users manage their own cards"
  on public.mq_cards
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own review events" on public.mq_review_events;
create policy "Users manage their own review events"
  on public.mq_review_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
