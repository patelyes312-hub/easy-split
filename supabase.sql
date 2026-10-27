-- EasySplit Live schema. Safe to run multiple times.
-- Run the whole file once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

/* ---------- Tables ---------- */
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null
);

create table if not exists public.groups(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.group_members(
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz default now(),
  unique(group_id,user_id)
);

-- Approval workflow columns (added idempotently for existing installs).
alter table public.group_members add column if not exists status text not null default 'active';
alter table public.group_members add column if not exists role text not null default 'member';

create table if not exists public.expenses(
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null,
  amount numeric(12,2) check(amount>0),
  paid_by_member_id uuid not null references public.group_members(id),
  expense_date date default current_date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz default now()
);

-- 'expense' = a normal shared cost; 'settlement' = a payment recorded to clear a
-- balance. Settlements count toward balances but are excluded from spending charts.
alter table public.expenses add column if not exists kind text not null default 'expense';

create table if not exists public.expense_splits(
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.group_members(id),
  amount numeric(12,2) check(amount>=0),
  unique(expense_id,member_id)
);

/* ---------- Functions & triggers ---------- */
-- Create a profile row automatically when an auth user is created.
create or replace function public.new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,email,full_name)
  values(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end$$;

drop trigger if exists auth_user_created on auth.users;
create trigger auth_user_created
  after insert on auth.users
  for each row execute procedure public.new_user();

-- Active membership check. security definer so it bypasses RLS and avoids recursion.
-- Pending members are NOT considered members, so they cannot read group data.
create or replace function public.member_of(g uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from group_members
    where group_id=g and user_id=auth.uid() and status='active'
  )
$$;

-- Owner check: true if the current user is the owner (approver) of the group.
create or replace function public.owns_group(g uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from group_members
    where group_id=g and user_id=auth.uid() and role='owner' and status='active'
  )
$$;

-- Create a group and add the creator as the active owner.
create or replace function public.create_group(p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare g uuid; p profiles;
begin
  select * into p from profiles where id=auth.uid();
  if p.id is null then
    raise exception 'Your profile is not set up yet. Please sign out and in again.';
  end if;
  insert into groups(name,created_by) values(p_name,auth.uid()) returning id into g;
  insert into group_members(group_id,user_id,display_name,email,status,role)
  values(g,p.id,p.full_name,p.email,'active','owner');
  return g;
end$$;

-- Invite an already-registered user. They start as PENDING and must be approved
-- by the group owner before they can access the group.
create or replace function public.add_group_member_by_email(p_group_id uuid,p_email text)
returns void language plpgsql security definer set search_path=public as $$
declare p profiles;
begin
  if not member_of(p_group_id) then
    raise exception 'Not authorised';
  end if;
  select * into p from profiles where lower(email)=lower(p_email);
  if p.id is null then
    raise exception 'User must register first';
  end if;
  insert into group_members(group_id,user_id,display_name,email,status,role)
  values(p_group_id,p.id,p.full_name,p.email,'pending','member')
  on conflict (group_id,user_id) do nothing;
end$$;

-- Owner approves a pending member.
create or replace function public.approve_group_member(p_member_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare g uuid;
begin
  select group_id into g from group_members where id=p_member_id;
  if g is null then raise exception 'Member not found'; end if;
  if not owns_group(g) then raise exception 'Only the group owner can approve members'; end if;
  update group_members set status='active' where id=p_member_id;
end$$;

-- Owner rejects/removes a member (cannot remove the owner).
create or replace function public.remove_group_member(p_member_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare g uuid; r text;
begin
  select group_id, role into g, r from group_members where id=p_member_id;
  if g is null then raise exception 'Member not found'; end if;
  if not owns_group(g) then raise exception 'Only the group owner can remove members'; end if;
  if r='owner' then raise exception 'The group owner cannot be removed'; end if;
  delete from group_members where id=p_member_id;
end$$;

-- Owner deletes the whole group (cascades to members, expenses and splits).
create or replace function public.delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not owns_group(p_group_id) then
    raise exception 'Only the group owner can delete this group';
  end if;
  delete from groups where id=p_group_id;
end$$;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.add_group_member_by_email(uuid,text) to authenticated;
grant execute on function public.approve_group_member(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;

/* ---------- Row level security ---------- */
alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for select to authenticated using(id=auth.uid());

drop policy if exists "member groups" on groups;
create policy "member groups" on groups for select to authenticated using(member_of(id));

-- Members (active) can read the member list. The owner can read ALL rows
-- (including pending) so they can approve them. A user can always read their
-- own membership row (so pending users can see their pending status).
drop policy if exists "group members read" on group_members;
create policy "group members read" on group_members for select to authenticated
  using(member_of(group_id) or owns_group(group_id) or user_id=auth.uid());

drop policy if exists "expenses read" on expenses;
create policy "expenses read" on expenses for select to authenticated using(member_of(group_id));

drop policy if exists "expenses insert" on expenses;
create policy "expenses insert" on expenses for insert to authenticated with check(member_of(group_id) and created_by=auth.uid());

drop policy if exists "expenses delete" on expenses;
create policy "expenses delete" on expenses for delete to authenticated using(member_of(group_id));

drop policy if exists "splits read" on expense_splits;
create policy "splits read" on expense_splits for select to authenticated using(exists(select 1 from expenses e where e.id=expense_id and member_of(e.group_id)));

drop policy if exists "splits insert" on expense_splits;
create policy "splits insert" on expense_splits for insert to authenticated with check(exists(select 1 from expenses e where e.id=expense_id and member_of(e.group_id)));

drop policy if exists "splits delete" on expense_splits;
create policy "splits delete" on expense_splits for delete to authenticated using(exists(select 1 from expenses e where e.id=expense_id and member_of(e.group_id)));

/* ---------- Realtime ---------- */
-- Add tables to the realtime publication, ignoring ones already added.
do $$
begin
  begin alter publication supabase_realtime add table public.group_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.expenses; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.expense_splits; exception when duplicate_object then null; end;
end$$;

/* ---------- Backfill ---------- */
-- Profiles for users who registered before this schema existed.
insert into public.profiles (id, email, full_name)
select u.id, u.email,
       coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1))
from auth.users u
on conflict (id) do nothing;

-- Existing members created before the approval columns existed stay active.
update public.group_members set status='active' where status is null;
-- Mark each group's creator as the owner (approver) if not already set.
update public.group_members gm
set role='owner'
from public.groups g
where gm.group_id=g.id and gm.user_id=g.created_by and gm.role<>'owner';
