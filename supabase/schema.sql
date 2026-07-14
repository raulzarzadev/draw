create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled drawing',
  scene jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drawings enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drawings_touch_updated_at on public.drawings;
create trigger drawings_touch_updated_at
before update on public.drawings
for each row
execute function public.touch_updated_at();

drop policy if exists "Users can read their own drawings" on public.drawings;
create policy "Users can read their own drawings"
on public.drawings for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can create their own drawings" on public.drawings;
create policy "Users can create their own drawings"
on public.drawings for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update their own drawings" on public.drawings;
create policy "Users can update their own drawings"
on public.drawings for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete their own drawings" on public.drawings;
create policy "Users can delete their own drawings"
on public.drawings for delete
to authenticated
using (auth.uid() = owner_id);
