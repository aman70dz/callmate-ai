create extension if not exists pgcrypto;

create table if not exists public.call_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_name text not null,
  phone_number text not null,
  instruction text not null,
  language text not null check (language in ('en','hi')),
  recipient_consent_confirmed boolean not null default false,
  max_attempts integer not null default 2 check (max_attempts = 2),
  retry_delay_minutes integer not null default 10 check (retry_delay_minutes = 10),
  attempts_made integer not null default 0 check (attempts_made between 0 and 2),
  status text not null default 'pending' check (status in ('pending','calling','retry_scheduled','completed','no_answer','failed','cancelled')),
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.call_tasks(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 2),
  provider_call_sid text unique,
  status text not null default 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  unique(task_id, attempt_number)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.call_tasks(id) on delete cascade,
  attempt_id uuid references public.call_attempts(id) on delete set null,
  session_id text,
  language text,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  speaker text not null check (speaker in ('assistant','recipient')),
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.call_summaries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.call_tasks(id) on delete cascade,
  summary text,
  outcome text,
  follow_up_required boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_tasks_user_created on public.call_tasks(user_id, created_at desc);
create index if not exists idx_call_tasks_retry on public.call_tasks(next_retry_at) where status='retry_scheduled';
create index if not exists idx_call_attempts_task on public.call_attempts(task_id);
create index if not exists idx_transcripts_conversation on public.transcripts(conversation_id);

alter table public.call_tasks enable row level security;
alter table public.call_attempts enable row level security;
alter table public.conversations enable row level security;
alter table public.transcripts enable row level security;
alter table public.call_summaries enable row level security;

drop policy if exists "users manage own call tasks" on public.call_tasks;
create policy "users manage own call tasks" on public.call_tasks for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users read own call attempts" on public.call_attempts;
create policy "users read own call attempts" on public.call_attempts for select to authenticated
using (exists(select 1 from public.call_tasks t where t.id=task_id and t.user_id=auth.uid()));

drop policy if exists "users read own conversations" on public.conversations;
create policy "users read own conversations" on public.conversations for select to authenticated
using (exists(select 1 from public.call_tasks t where t.id=task_id and t.user_id=auth.uid()));

drop policy if exists "users read own transcripts" on public.transcripts;
create policy "users read own transcripts" on public.transcripts for select to authenticated
using (exists(select 1 from public.conversations c join public.call_tasks t on t.id=c.task_id where c.id=conversation_id and t.user_id=auth.uid()));

drop policy if exists "users read own summaries" on public.call_summaries;
create policy "users read own summaries" on public.call_summaries for select to authenticated
using (exists(select 1 from public.call_tasks t where t.id=task_id and t.user_id=auth.uid()));
