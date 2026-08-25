-- ============================================================
--  سامانه اشتراک‌های گاز — اسکیمای Supabase (نسخه ۲)
--  این فایل را کامل در Supabase SQL Editor اجرا کنید
--  (Dashboard → SQL Editor → New query → Paste → Run)
--  ✅ دوباره اجرا کردن آن دیتا را پاک نمی‌کند
-- ============================================================

-- ---------- جداول ----------
create table if not exists public.managers (
  id bigint generated always as identity primary key,
  name text unique not null,
  color text default '#38bdf8',
  created_at timestamptz default now()
);

create table if not exists public.subs (
  id bigint generated always as identity primary key,
  sub_no text unique not null,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.uploads (
  id bigint generated always as identity primary key,
  filename text,
  manager_id bigint references public.managers(id),
  visit_date date,
  total integer default 0,
  new_count integer default 0,
  dup_count integer default 0,
  notfound_count integer default 0,
  uploaded_by text,
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.uploads add column if not exists details jsonb default '{}'::jsonb;

create table if not exists public.records (
  id bigint generated always as identity primary key,
  sub_no text not null,
  manager_id bigint references public.managers(id),
  upload_id bigint references public.uploads(id) on delete cascade,
  status text not null check (status in ('new','duplicate','not_found')),
  prev_record_id bigint,
  data jsonb default '{}'::jsonb,
  visit_date date,
  created_at timestamptz default now()
);

create index if not exists idx_records_sub_no on public.records(sub_no);
create index if not exists idx_records_date on public.records(visit_date);
create index if not exists idx_records_mgr on public.records(manager_id);
create index if not exists idx_records_upload on public.records(upload_id);

-- ---------- داده اولیه: سه مدیر پروژه ----------
insert into public.managers (name, color) values
  ('مدیر پروژه ۱', '#38bdf8'),
  ('مدیر پروژه ۲', '#f59e0b'),
  ('مدیر پروژه ۳', '#34d399')
on conflict (name) do nothing;

-- ---------- امنیت: فقط کاربران لاگین‌شده ----------
alter table public.managers enable row level security;
alter table public.subs enable row level security;
alter table public.uploads enable row level security;
alter table public.records enable row level security;

drop policy if exists "auth full" on public.managers;
drop policy if exists "auth full" on public.subs;
drop policy if exists "auth full" on public.uploads;
drop policy if exists "auth full" on public.records;

create policy "auth full" on public.managers for all to authenticated using (true) with check (true);
create policy "auth full" on public.subs for all to authenticated using (true) with check (true);
create policy "auth full" on public.uploads for all to authenticated using (true) with check (true);
create policy "auth full" on public.records for all to authenticated using (true) with check (true);

-- ---------- ویوها ----------
create or replace view public.records_view
with (security_invoker = on) as
select
  r.id, r.sub_no, r.status, r.visit_date, r.upload_id, r.manager_id, r.data,
  m.name as manager_name,
  u.filename,
  exists(select 1 from public.subs s where s.sub_no = r.sub_no) as in_master,
  pr.visit_date as prev_date,
  pm.name as prev_manager
from public.records r
left join public.managers m on m.id = r.manager_id
left join public.uploads u on u.id = r.upload_id
left join public.records pr on pr.id = r.prev_record_id
left join public.managers pm on pm.id = pr.manager_id;

create or replace view public.subs_view
with (security_invoker = on) as
select
  s.id, s.sub_no, s.data, s.created_at,
  (select count(*) from public.records r where r.sub_no = s.sub_no) as times
from public.subs s;

-- ============================================================
--  توابع
-- ============================================================

-- استخراج نام ممیز/بازدیدکننده از ستون‌های ردیف اکسل
create or replace function public.extract_inspector(p_data jsonb)
returns text language plpgsql immutable as $$
declare
  v text;
begin
  select e.v into v
  from jsonb_each_text(coalesce(p_data, '{}'::jsonb)) as e(k, v)
  where e.k ~* '(بازدید|ممیز|بازرس|ناظر|تنظیم کنند|تنظیم‌کنند|ثبت کنند|ثبت‌کنند|تهیه کنند|تهیه‌کنند|inspector)'
  limit 1;
  return v;
end $$;

-- فایل روزانه — روند ۴ مرحله‌ای (نسخه ۵):
--   ۱) تکراریِ داخل خود فایل؟ → نمایش (ifd)
--   ۲) در لیست شرکت گاز نیست؟ → نمایش (nf) + ثبت وضعیت not_found برای دسترسی همیشگی
--   ۳) قبلاً ثبت شده (status=new)؟ → نمایش تکراری با مشخصات ثبت اول (dup)
--   ۴) سالم → ثبت (new)
-- هیچ داده‌ای حذف نمی‌شود؛ همه موارد در details و records باقی می‌مانند.
create or replace function public.process_upload(
  p_filename text,
  p_manager_id bigint,
  p_visit_date date,
  p_rows jsonb,             -- آرایه‌ای از {"no": "...", "data": {...}}
  p_uploaded_by text default null,
  p_nm_items jsonb default '[]'::jsonb   -- ردیف‌های بدون مدیر (از سمت مرورگر)
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_upload_id bigint;
  v_total integer := 0;
  v_new integer := 0;
  v_dup integer := 0;
  v_nf integer := 0;
  v_ifd integer := 0;
  v_dup_items jsonb := '[]'::jsonb;
  v_nf_items jsonb := '[]'::jsonb;
  v_ifd_items jsonb := '[]'::jsonb;
  v_row jsonb; v_no text; v_first bigint; v_mid bigint;
  v_pm text; v_pd date; v_pdata jsonb;
  v_seen text[] := '{}';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into uploads (filename, manager_id, visit_date, uploaded_by)
  values (p_filename, p_manager_id, p_visit_date, p_uploaded_by)
  returning id into v_upload_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_no := upper(btrim(coalesce(v_row->>'no', '')));
    if v_no = '' then continue; end if;
    v_total := v_total + 1;
    v_mid := coalesce(nullif(v_row->>'mid', '')::bigint, p_manager_id);

    -- مرحله ۱: تکراری داخل خود فایل روزانه (بار دوم به بعد)
    if v_no = any(v_seen) then
      v_ifd := v_ifd + 1;
      v_ifd_items := v_ifd_items || jsonb_build_object(
        'no', v_no, 'data', coalesce(v_row->'data', '{}'::jsonb));
      continue;
    end if;
    v_seen := v_seen || v_no;

    -- مرحله ۲: موجود در لیست شرکت گاز؟ نه → نمایش + ثبت وضعیت not_found (یک‌بار برای هر شماره)
    if not exists (select 1 from subs where sub_no = v_no) then
      v_nf := v_nf + 1;
      v_nf_items := v_nf_items || jsonb_build_object(
        'no', v_no, 'data', coalesce(v_row->'data', '{}'::jsonb));
      if not exists (select 1 from records where sub_no = v_no and status = 'not_found') then
        insert into records (sub_no, manager_id, upload_id, status, data, visit_date)
        values (v_no, null, v_upload_id, 'not_found',
                coalesce(v_row->'data', '{}'::jsonb), p_visit_date);
      end if;
      continue;
    end if;

    -- مرحله ۳: قبلاً «ثبت‌شده» (new)؟ بله → تکراری با مشخصات ثبت اول
    select id into v_first from records
    where sub_no = v_no and status = 'new' order by id limit 1;
    if v_first is not null then
      select m.name, pr.visit_date, pr.data into v_pm, v_pd, v_pdata
      from records pr left join managers m on m.id = pr.manager_id
      where pr.id = v_first;
      v_dup_items := v_dup_items || jsonb_build_object(
        'no', v_no, 'data', coalesce(v_row->'data', '{}'::jsonb),
        'prev_date', v_pd,
        'prev_manager', v_pm,
        'prev_inspector', public.extract_inspector(v_pdata));
      continue;
    end if;

    -- مرحله ۴: معتبر و جدید → ثبت می‌شود
    v_new := v_new + 1;
    insert into records (sub_no, manager_id, upload_id, status, data, visit_date)
    values (v_no, v_mid, v_upload_id, 'new',
            coalesce(v_row->'data', '{}'::jsonb), p_visit_date);
  end loop;

  update uploads set
    total = v_total,
    new_count = v_new,
    dup_count = jsonb_array_length(v_dup_items),
    notfound_count = jsonb_array_length(v_nf_items),
    details = jsonb_build_object('dupItems', v_dup_items, 'nfItems', v_nf_items,
                                 'ifdItems', v_ifd_items, 'nmItems', p_nm_items)
  where id = v_upload_id;

  return json_build_object(
    'uploadId', v_upload_id,
    'total', v_total, 'new', v_new,
    'dup', jsonb_array_length(v_dup_items),
    'nf', jsonb_array_length(v_nf_items),
    'ifd', jsonb_array_length(v_ifd_items),
    'dupItems', v_dup_items, 'nfItems', v_nf_items, 'ifdItems', v_ifd_items);
end $$;

-- ایمپورت «فایل دوم» (اشتراک‌های ثبت‌شده قبلی) — فقط شماره‌های معتبر و جدید
-- ایمپورت «فایل دوم» (اشتراک‌های ثبت‌شده قبلی) — همان روند ۴ مرحله‌ای فایل روزانه:
--   ۱) تکراری داخل خود فایل (ifd)  ۲) ناموجود در لیست گاز (nf + رکورد not_found)
--   ۳) تکراری با ثبت‌شده‌ها (dup)  ۴) ثبت (new)
create or replace function public.import_registered(
  p_filename text,
  p_manager_id bigint,
  p_visit_date date,
  p_rows jsonb,
  p_uploaded_by text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_upload_id bigint;
  v_total integer := 0; v_added integer := 0; v_dup integer := 0; v_nf integer := 0; v_ifd integer := 0;
  v_row jsonb; v_no text; v_mid bigint; v_first bigint;
  v_dup_items jsonb := '[]'::jsonb; v_nf_items jsonb := '[]'::jsonb; v_ifd_items jsonb := '[]'::jsonb;
  v_pm text; v_pd date; v_pdata jsonb;
  v_seen text[] := '{}';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into uploads (filename, manager_id, visit_date, uploaded_by)
  values ('[ثبت‌های قبلی] ' || coalesce(p_filename, ''), p_manager_id, p_visit_date, p_uploaded_by)
  returning id into v_upload_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_no := upper(btrim(coalesce(v_row->>'no', '')));
    if v_no = '' then continue; end if;
    v_total := v_total + 1;
    v_mid := coalesce(nullif(v_row->>'mid', '')::bigint, p_manager_id);

    -- ۱) تکراری داخل خود فایل
    if v_no = any(v_seen) then
      v_ifd := v_ifd + 1;
      v_ifd_items := v_ifd_items || jsonb_build_object('no', v_no, 'data', coalesce(v_row->'data', '{}'::jsonb));
      continue;
    end if;
    v_seen := v_seen || v_no;

    -- ۲) ناموجود در لیست شرکت گاز (+ ثبت وضعیت not_found)
    if not exists (select 1 from subs where sub_no = v_no) then
      v_nf := v_nf + 1;
      v_nf_items := v_nf_items || jsonb_build_object('no', v_no, 'data', coalesce(v_row->'data', '{}'::jsonb));
      if not exists (select 1 from records where sub_no = v_no and status = 'not_found') then
        insert into records (sub_no, manager_id, upload_id, status, data, visit_date)
        values (v_no, null, v_upload_id, 'not_found', coalesce(v_row->'data', '{}'::jsonb), p_visit_date);
      end if;
      continue;
    end if;

    -- ۳) تکراری با ثبت‌شده‌های قبلی
    select id into v_first from records
    where sub_no = v_no and status = 'new' order by id limit 1;
    if v_first is not null then
      select pr2.visit_date, mm2.name, pr2.data into v_pd, v_pm, v_pdata
      from records pr2 left join managers mm2 on mm2.id = pr2.manager_id
      where pr2.id = v_first;
      v_dup := v_dup + 1;
      v_dup_items := v_dup_items || jsonb_build_object(
        'no', v_no, 'data', coalesce(v_row->'data', '{}'::jsonb),
        'prev_date', v_pd, 'prev_manager', v_pm,
        'prev_inspector', public.extract_inspector(v_pdata));
      continue;
    end if;

    -- ۴) ثبت
    v_added := v_added + 1;
    insert into records (sub_no, manager_id, upload_id, status, data, visit_date)
    values (v_no, v_mid, v_upload_id, 'new',
            coalesce(v_row->'data', '{}'::jsonb),
            coalesce(nullif(v_row->>'vd', '')::date, p_visit_date));
  end loop;

  update uploads set total = v_total, new_count = v_added, dup_count = v_dup, notfound_count = v_nf,
    details = jsonb_build_object('dupItems', v_dup_items, 'nfItems', v_nf_items, 'ifdItems', v_ifd_items)
  where id = v_upload_id;

  return json_build_object('uploadId', v_upload_id, 'total', v_total,
                           'added'   , v_added, 'new', v_added,
                           'dup'     , v_dup, 'nf', v_nf, 'ifd', v_ifd,
                           'dupItems', v_dup_items, 'nfItems', v_nf_items, 'ifdItems', v_ifd_items);
end $$;

-- آمار داشبورد
create or replace function public.dashboard_stats(p_from date default null, p_to date default null, p_manager bigint default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date; v_to date;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_to := coalesce(p_to, current_date);
  v_from := coalesce(p_from, (select min(visit_date) from records), current_date);

  return json_build_object(
    'from', v_from,
    'to', v_to,
    'masterCount', (select count(*) from subs),
    'registeredUnique', (select count(distinct sub_no) from records where status = 'new' and (p_manager is null or manager_id = p_manager)),
    'validUnique', (select count(distinct r.sub_no) from records r
                     where (p_manager is null or r.manager_id = p_manager)
                       and exists (select 1 from subs s where s.sub_no = r.sub_no)),
    'totalRows', (select count(*) from records where p_manager is null or manager_id = p_manager),
    'todayRows', (select count(*) from records where visit_date = current_date and status = 'new' and (p_manager is null or manager_id = p_manager)),
    'dupRows', coalesce((select sum(dup_count) from uploads where p_manager is null or manager_id = p_manager), 0),
    'nfRows', coalesce((select sum(notfound_count) from uploads where p_manager is null or manager_id = p_manager), 0),
    'bar', coalesce((select json_agg(x) from (
        select r.manager_id, count(distinct r.sub_no) as c from records r
        where r.visit_date between v_from and v_to
          and (p_manager is null or r.manager_id = p_manager)
          and exists (select 1 from subs s where s.sub_no = r.sub_no)
        group by r.manager_id) x), '[]'::json),
    'line', coalesce((select json_agg(y) from (
        select r.visit_date as d, r.manager_id, count(distinct r.sub_no) as c from records r
        where r.visit_date between v_from and v_to
          and (p_manager is null or r.manager_id = p_manager)
          and exists (select 1 from subs s where s.sub_no = r.sub_no)
        group by r.visit_date, r.manager_id order by r.visit_date) y), '[]'::json),
    'mgrStats', coalesce((select json_agg(z) from (
        select u.manager_id,
               sum(u.total) as rows_n,
               sum(u.dup_count) as dups,
               sum(u.notfound_count) as nf,
               sum(u.new_count) as uniq
        from uploads u
        where u.visit_date between v_from and v_to
        group by u.manager_id) z), '[]'::json)
  );
end $$;

-- محاسبه مجدد وضعیت‌ها (سازگاری با داده‌های قدیمی)
create or replace function public.recompute_statuses()
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  create temporary table if not exists _seen_subs (sub_no text primary key) on commit drop;
  truncate _seen_subs;
  for r in select id, sub_no from records order by visit_date nulls last, id loop
    if exists (select 1 from _seen_subs where sub_no = r.sub_no) then
      update records set status = 'duplicate',
        prev_record_id = (select min(s2.id) from records s2 where s2.sub_no = r.sub_no and s2.id < r.id)
      where id = r.id;
    else
      insert into _seen_subs (sub_no) values (r.sub_no) on conflict do nothing;
      update records set status = case when exists (select 1 from subs where subs.sub_no = r.sub_no)
                                       then 'new' else 'not_found' end,
                         prev_record_id = null
      where id = r.id;
    end if;
  end loop;
end $$;

-- حذف یک فایل آپلودشده
create or replace function public.delete_upload(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from uploads where id = p_id;   -- records با cascade حذف می‌شوند
end $$;

-- حذف کلی تاریخچه آپلودها — اشتراک‌های «ثبت‌شده» حفظ می‌شوند (نسخه دسته‌ای مقاوم؛ بدون قفل/تایم‌اوت)
create or replace function public.delete_all_uploads()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_up bigint; v_rec bigint; v_del integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select count(*) into v_rec from records;
  select count(*) into v_up from uploads;
  loop
    update records set upload_id = null
      where upload_id in (select id from uploads order by id limit 50000);
    delete from uploads
      where id in (select id from uploads order by id limit 50000);
    get diagnostics v_del = row_count;
    exit when v_del = 0;
  end loop;
  return json_build_object('uploads', v_up, 'kept_records', v_rec);
end $$;

-- بازنشانی کامل داده‌ها (منطقه خطرناک)
create or replace function public.reset_all()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  truncate public.records, public.uploads, public.subs, public.managers restart identity;
  insert into public.managers (name, color) values
    ('مدیر پروژه ۱', '#38bdf8'),
    ('مدیر پروژه ۲', '#f59e0b'),
    ('مدیر پروژه ۳', '#34d399');
end $$;


-- حجم دیتابیس و جدول‌ها (برای نمایش در داشبورد سایت)
create or replace function public.db_usage()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total', pg_database_size(current_database()),
    'subs', pg_total_relation_size('public.subs'),
    'records', pg_total_relation_size('public.records'),
    'uploads', pg_total_relation_size('public.uploads'),
    'managers', pg_total_relation_size('public.managers'),
    'quota_mb', 500)
$$;


-- فهرست ممیزهای یک مدیر پروژه با تعداد ثبت‌ها
create or replace function public.manager_inspectors(p_manager bigint, p_from date default null, p_to date default null)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('rows', coalesce(json_agg(x), '[]'::json)) from (
    select coalesce(nullif(public.extract_inspector(data), ''), 'بدون ممیز') as insp,
           count(*) as c,
           count(*) filter (where visit_date = current_date) as today_c
    from records
    where manager_id = p_manager and status = 'new'
      and visit_date between coalesce(p_from, date '1900-01-01') and coalesce(p_to, date '2100-12-31')
    group by 1 order by 2 desc
  ) x;
$$;

-- ---------- دسترسی‌ها ----------
revoke all on function public.db_usage() from public, anon;
revoke all on function public.extract_inspector(jsonb) from public, anon;
revoke all on function public.process_upload(text, bigint, date, jsonb, text, jsonb) from public, anon;
revoke all on function public.import_registered(text, bigint, date, jsonb, text) from public, anon;
revoke all on function public.dashboard_stats(date, date, bigint) from public, anon;
revoke all on function public.manager_inspectors(bigint, date, date) from public, anon;
revoke all on function public.recompute_statuses() from public, anon;
revoke all on function public.delete_upload(bigint) from public, anon;
revoke all on function public.reset_all() from public, anon;
revoke all on function public.delete_all_uploads() from public, anon;

grant execute on function public.db_usage() to authenticated;
grant execute on function public.extract_inspector(jsonb) to authenticated;
grant execute on function public.process_upload(text, bigint, date, jsonb, text, jsonb) to authenticated;
grant execute on function public.import_registered(text, bigint, date, jsonb, text) to authenticated;
grant execute on function public.dashboard_stats(date, date, bigint) to authenticated;
grant execute on function public.manager_inspectors(bigint, date, date) to authenticated;
grant execute on function public.recompute_statuses() to authenticated;
grant execute on function public.delete_upload(bigint) to authenticated;
grant execute on function public.reset_all() to authenticated;
grant execute on function public.delete_all_uploads() to authenticated;

grant select, insert, update, delete on public.managers, public.subs, public.uploads, public.records to authenticated;
grant select on public.records_view, public.subs_view to authenticated;
grant usage on all sequences in schema public to authenticated;

-- پایان ✅
