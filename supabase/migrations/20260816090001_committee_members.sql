-- ============================================================================
-- Committee Members: table, RLS, SECURITY DEFINER CRUD functions, and seed.
--
-- Authorization model:
--   * Public/anon: may read only active committee members (for the About page).
--   * admin/owner: full CRUD via SECURITY DEFINER functions.
--   * student/contributor: no write access (RLS + function checks enforce this).
--   * No service_role key is used. All privileged writes go through functions.
--
-- Committee membership is independent of website roles. A committee member
-- does NOT need a website account. The optional user_id column links a
-- committee record to an existing website user when one exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
create table public.committee_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid null references public.profiles(id) on delete set null,
  name_ar     text not null,
  name_en     text not null,
  major_ar    text not null,
  major_en    text not null,
  role_ar     text not null,
  role_en     text not null,
  gender      text not null check (gender in ('male', 'female')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A website user must not be added to the committee twice.
create unique index committee_members_user_id_idx
  on public.committee_members (user_id)
  where user_id is not null;

-- Fast ordered reads for the public carousel
create index committee_members_active_idx
  on public.committee_members (sort_order asc, created_at asc)
  where is_active = true;

-- ----------------------------------------------------------------------------
-- 2. Auto-maintain updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_committee_members_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger committee_members_updated_at
  before update on public.committee_members
  for each row
  execute function public.set_committee_members_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
alter table public.committee_members enable row level security;

-- Public/anon: read only active members
create policy "public can read active committee members"
  on public.committee_members
  for select
  to anon, authenticated
  using (is_active = true);

-- All write access goes through SECURITY DEFINER functions below.
-- No INSERT/UPDATE/DELETE policies exist — direct writes are blocked by RLS.

-- ----------------------------------------------------------------------------
-- 4. SECURITY DEFINER helper: check caller is admin or owner
-- ----------------------------------------------------------------------------
create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role is null
     or actor_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'insufficient privileges';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. admin_list_committee_members: list all members (admin only)
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_committee_members()
returns table (
  id         uuid,
  user_id    uuid,
  name_ar    text,
  name_en    text,
  major_ar   text,
  major_en   text,
  role_ar    text,
  role_en    text,
  gender     text,
  sort_order integer,
  is_active  boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
    select cm.id, cm.user_id, cm.name_ar, cm.name_en, cm.major_ar, cm.major_en,
           cm.role_ar, cm.role_en, cm.gender, cm.sort_order, cm.is_active,
           cm.created_at, cm.updated_at
      from public.committee_members cm
     order by cm.sort_order asc, cm.created_at asc;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. admin_get_committee_member: get a single member (admin only)
-- ----------------------------------------------------------------------------
create or replace function public.admin_get_committee_member(p_id uuid)
returns table (
  id         uuid,
  user_id    uuid,
  name_ar    text,
  name_en    text,
  major_ar   text,
  major_en   text,
  role_ar    text,
  role_en    text,
  gender     text,
  sort_order integer,
  is_active  boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
    select cm.id, cm.user_id, cm.name_ar, cm.name_en, cm.major_ar, cm.major_en,
           cm.role_ar, cm.role_en, cm.gender, cm.sort_order, cm.is_active,
           cm.created_at, cm.updated_at
      from public.committee_members cm
     where cm.id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. admin_create_committee_member: insert a new member (admin only)
-- ----------------------------------------------------------------------------
create or replace function public.admin_create_committee_member(
  p_name_ar    text,
  p_name_en    text,
  p_major_ar   text,
  p_major_en   text,
  p_role_ar    text,
  p_role_en    text,
  p_gender     text,
  p_sort_order integer default 0,
  p_is_active  boolean default true,
  p_user_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.require_admin();

  -- Validate required fields
  if btrim(p_name_ar) = '' then raise exception 'name_ar is required'; end if;
  if btrim(p_name_en) = '' then raise exception 'name_en is required'; end if;
  if btrim(p_major_ar) = '' then raise exception 'major_ar is required'; end if;
  if btrim(p_major_en) = '' then raise exception 'major_en is required'; end if;
  if btrim(p_role_ar) = '' then raise exception 'role_ar is required'; end if;
  if btrim(p_role_en) = '' then raise exception 'role_en is required'; end if;
  if p_gender not in ('male', 'female') then raise exception 'gender must be male or female'; end if;

  -- Validate user_id references an existing profile
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_id does not reference an existing user';
  end if;

  insert into public.committee_members
    (user_id, name_ar, name_en, major_ar, major_en, role_ar, role_en, gender, sort_order, is_active)
  values
    (p_user_id, btrim(p_name_ar), btrim(p_name_en), btrim(p_major_ar), btrim(p_major_en),
     btrim(p_role_ar), btrim(p_role_en), p_gender, p_sort_order, p_is_active)
  returning id into new_id;

  return new_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. admin_update_committee_member: update an existing member (admin only)
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_committee_member(
  p_id         uuid,
  p_name_ar    text,
  p_name_en    text,
  p_major_ar   text,
  p_major_en   text,
  p_role_ar    text,
  p_role_en    text,
  p_gender     text,
  p_sort_order integer,
  p_is_active  boolean,
  p_user_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  -- Validate required fields
  if btrim(p_name_ar) = '' then raise exception 'name_ar is required'; end if;
  if btrim(p_name_en) = '' then raise exception 'name_en is required'; end if;
  if btrim(p_major_ar) = '' then raise exception 'major_ar is required'; end if;
  if btrim(p_major_en) = '' then raise exception 'major_en is required'; end if;
  if btrim(p_role_ar) = '' then raise exception 'role_ar is required'; end if;
  if btrim(p_role_en) = '' then raise exception 'role_en is required'; end if;
  if p_gender not in ('male', 'female') then raise exception 'gender must be male or female'; end if;

  -- Validate user_id references an existing profile (or is null to unlink)
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_id does not reference an existing user';
  end if;

  update public.committee_members
     set user_id    = p_user_id,
         name_ar    = btrim(p_name_ar),
         name_en    = btrim(p_name_en),
         major_ar   = btrim(p_major_ar),
         major_en   = btrim(p_major_en),
         role_ar    = btrim(p_role_ar),
         role_en    = btrim(p_role_en),
         gender     = p_gender,
         sort_order = p_sort_order,
         is_active  = p_is_active
   where id = p_id;

  if not found then
    raise exception 'committee member not found';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. admin_delete_committee_member: hard delete (admin only)
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_committee_member(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  delete from public.committee_members where id = p_id;

  if not found then
    raise exception 'committee member not found';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. public_list_committee_members: public read for the About page
--      Returns only active members, ordered by sort_order.
--      No auth required — anon and authenticated can both call it.
-- ----------------------------------------------------------------------------
create or replace function public.public_list_committee_members()
returns table (
  name       text,
  role       text,
  major      text,
  gender     text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when current_setting('request.headers', true)::jsonb ->> 'accept-language' = 'ar'
        then cm.name_ar
      else cm.name_en
    end as name,
    case
      when current_setting('request.headers', true)::jsonb ->> 'accept-language' = 'ar'
        then cm.role_ar
      else cm.role_en
    end as role,
    case
      when current_setting('request.headers', true)::jsonb ->> 'accept-language' = 'ar'
        then cm.major_ar
      else cm.major_en
    end as major,
    cm.gender
  from public.committee_members cm
  where cm.is_active = true
  order by cm.sort_order asc, cm.created_at asc;
$$;

-- ----------------------------------------------------------------------------
-- 11. Least-privilege grants
-- ----------------------------------------------------------------------------
revoke all on function public.require_admin() from public;
revoke all on function public.admin_list_committee_members() from public;
revoke all on function public.admin_get_committee_member(uuid) from public;
revoke all on function public.admin_create_committee_member(
  text,text,text,text,text,text,text,integer,boolean,uuid
) from public;
revoke all on function public.admin_update_committee_member(
  uuid,text,text,text,text,text,text,text,integer,boolean,uuid
) from public;
revoke all on function public.admin_delete_committee_member(uuid) from public;
revoke all on function public.public_list_committee_members() from public;

grant execute on function public.require_admin() to authenticated;
grant execute on function public.admin_list_committee_members() to authenticated;
grant execute on function public.admin_get_committee_member(uuid) to authenticated;
grant execute on function public.admin_create_committee_member(
  text,text,text,text,text,text,text,integer,boolean,uuid
) to authenticated;

grant execute on function public.admin_update_committee_member(
  uuid,text,text,text,text,text,text,text,integer,boolean,uuid
) to authenticated;
grant execute on function public.admin_delete_committee_member(uuid) to authenticated;
grant execute on function public.public_list_committee_members() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 12. Seed: migrate the existing 31 committee members
-- ----------------------------------------------------------------------------
insert into public.committee_members
  (user_id, name_ar, name_en, major_ar, major_en, role_ar, role_en, gender, sort_order, is_active)
values
  (null, 'ملك نعيمي',      'Malak Naimi',            'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'رئيس اللجنة العلمية', 'Head of the Scientific Committee', 'female', 1,  true),
  (null, 'ألين عداربة',     'Aleen Adarbeh',           'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'رئيس اللجنة العلمية', 'Head of the Scientific Committee', 'female', 2,  true),
  (null, 'تسنيم مبارك',    'Tasneem Mubarak',         'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 3,  true),
  (null, 'راما سلامة',     'Rama Salama',             'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 4,  true),
  (null, 'تالا عجاج',      'Tala Ajaj',               'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 5,  true),
  (null, 'كنانة حسنات',    'Kinanah Hasanat',         'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 6,  true),
  (null, 'زينب رومي',      'Zainab Rome',             'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 7,  true),
  (null, 'ميرا غسان',      'Meera Ghassan',           'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 8,  true),
  (null, 'تسنيم جمال',     'Tasneem Jamal',           'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 9,  true),
  (null, 'سجى تعامرة',     'Saja Tammra',             'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 10, true),
  (null, 'سيما قدومات',    'Seema Qudimat',           'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 11, true),
  (null, 'يمنى أبو الريش', 'Yomna Abureesh',          'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 12, true),
  (null, 'لجين بحيص',      'Lujain Bhais',            'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 13, true),
  (null, 'لانا عرمان',     'Lana Arman',              'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 14, true),
  (null, 'شهد حروب',       'Shahed Hroub',            'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 15, true),
  (null, 'حلا أمجد',       'Hala Amjad',              'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 16, true),
  (null, 'حلا الطويل',     'Hala Altaweel',           'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 17, true),
  (null, 'نمير غنيمات',    'Nameer Ghnemat',          'علم الحاسوب',         'Computer Science',             'عضو', 'Member', 'female', 18, true),
  (null, 'حلا سلامين',     'Hala Salameen',           'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'female', 19, true),
  (null, 'حذيفة ثوابتة',   'Huthaifa Thawabteh',      'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   20, true),
  (null, 'محمد بلّوط',     'Mohammad Balloot',        'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   21, true),
  (null, 'محمد باسل',      'Mohammad Basel',          'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   22, true),
  (null, 'محمد موسى',      'Mohammad Mousa',          'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   23, true),
  (null, 'يحيى أبو صبحة',  'Yahya Abu Sabha',         'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   24, true),
  (null, 'هاشم أبو فارة',  'Hashim Abufara',          'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   25, true),
  (null, 'صهيب حوشة',      'Suhaib Housheh',          'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   26, true),
  (null, 'محمد ديرية',     'Mohammad Diriyeh',        'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   27, true),
  (null, 'عبد الفتاح شوابكة', 'Abdel Fattah Shawabka', 'علم الحاسوب',       'Computer Science',             'عضو', 'Member', 'male',   28, true),
  (null, 'حسن نجّار',      'Hasan Najjar',            'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   29, true),
  (null, 'محمد عمرو',      'Mohammad Amr',            'هندسة أنظمة الحاسوب', 'Computer Systems Engineering', 'عضو', 'Member', 'male',   30, true),
  (null, 'إيناس عيسى',     'Enas Issa',               'علم الحاسوب',         'Computer Science',             'عضو', 'Member', 'female', 31, true);

-- ----------------------------------------------------------------------------
-- 13. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select count(*) from public.committee_members;                   -- expect 31
-- select count(*) from public.committee_members where is_active;   -- expect 31
-- select count(*) from public.committee_members where gender = 'female'; -- expect 20
-- select count(*) from public.committee_members where gender = 'male';   -- expect 11
-- select proname, prosecdef from pg_proc where proname like 'admin_%committee%' or proname = 'public_list_committee_members';
