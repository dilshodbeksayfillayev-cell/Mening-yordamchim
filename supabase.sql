-- Telegram Business bot uchun jadvallar. Supabase → SQL Editor'da bir marta ishga tushiring.
-- Bot service role kaliti bilan ishlaydi; RLS yoqilgan, siyosat yo'q — brauzerdan hech kim o'qiy olmaydi.

create table if not exists public.tgb_messages (
  id            bigint generated always as identity primary key,
  chat_id       bigint      not null,
  role          text        not null,          -- user | assistant
  content       text        not null,
  tg_message_id bigint,
  created_at    timestamptz not null default now(),
  from_name     text,                          -- mijoz ismi | bot | owner | owner_dm
  flag          text,                          -- buyurtma,shikoyat,handoff,pdf,...
  media         jsonb                          -- { kind, file_id, mime, size, name }
);
create index if not exists tgb_messages_chat_idx    on public.tgb_messages (chat_id, id desc);
create index if not exists tgb_messages_created_idx on public.tgb_messages (created_at);

create table if not exists public.tgb_kv (
  key        text primary key,                 -- profile | work_hours | flags | bcid | ...
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tgb_chats (
  chat_id         bigint primary key,
  name            text,
  handoff         boolean     not null default false,
  updated_at      timestamptz not null default now(),
  handoff_at      timestamptz,
  muted           boolean     not null default false,
  last_message_at timestamptz
);
create index if not exists tgb_chats_last_idx on public.tgb_chats (last_message_at desc);

alter table public.tgb_messages enable row level security;
alter table public.tgb_kv       enable row level security;
alter table public.tgb_chats    enable row level security;
