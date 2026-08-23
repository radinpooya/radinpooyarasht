-- ============================================================
--  سامانه اشتراک‌های گاز — اسکیمای Supabase
--  این فایل را یک‌بار کامل در Supabase SQL Editor اجرا کنید
--  (Dashboard → SQL Editor → New query → Paste → Run)
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
  created_at timestamptz default now()
);

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

create policy "auth full" on public.managers for all to authenticated using (true) with check (true);
create policy "auth full" on public.subs for all to authenticated using (true) with check (true);
create policy "auth full" on public.uploads for all to authenticated using (true) with check (true);
create policy "auth full" on public.records for all to authenticated using (true) with check (true);

-- ---------- ویوها (برای کوئری ساده از سمت سایت) ----------
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
--  توابع (منطق اصلی — سمت دیتابیس اجرا می‌شود)
-- ============================================================

-- پردازش فایل روزانه: بررسی تکراری/جدید/ناموجود برای هر شماره اشتراک
create or replace function public.process_upload(
  p_filename text,
  p_manager_id bigint,
  p_visit_date date,
  p_rows jsonb,             -- آرایه‌ای از {"no": "...", "data": {...}}
  p_uploaded_by text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_upload_id bigint;
  v_total integer := 0; v_new integer := 0; v_dup integer := 0; v_nf integer := 0;
  v_row jsonb; v_no text; v_first bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into uploads (filename, manager_id, visit_date, uploaded_by)
  values (p_filename, p_manager_id, p_visit_date, p_uploaded_by)
  returning id into v_upload_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_no := upper(btrim(coalesce(v_row->>'no', '')));
    if v_no = '' then continue; end if;
    v_total := v_total + 1;

    select id into v_first from records where sub_no = v_no order by id limit 1;

    if v_first is not null then
      v_dup := v_dup + 1;
      insert into records (sub_no, manager_id, upload_id, status, prev_record_id, data, visit_date)
      values (v_no, p_manager_id, v_upload_id, 'duplicate', v_first, coalesce(v_row->'data','{}'::jsonb), p_visit_date);
    elsif exists (select 1 from subs where sub_no = v_no) then
      v_new := v_new + 1;
      insert into records (sub_no, manager_id, upload_id, status, prev_record_id, data, visit_date)
      values (v_no, p_manager_id, v_upload_id, 'new', null, coalesce(v_row->'data','{}'::jsonb), p_visit_date);
    else
      v_nf := v_nf + 1;
      insert into records (sub_no, manager_id, upload_id, status, prev_record_id, data, visit_date)
      values (v_no, p_manager_id, v_upload_id, 'not_found', null, coalesce(v_row->'data','{}'::jsonb), p_visit_date);
    end if;
  end loop;

  update uploads set total = v_total, new_count = v_new, dup_count = v_dup, notfound_count = v_nf
  where id = v_upload_id;

  return json_build_object('uploadId', v_upload_id, 'total', v_total, 'new', v_new, 'dup', v_dup, 'nf', v_nf);
end $$;

-- آمار داشبورد
create or replace function public.dashboard_stats(p_from date default null, p_to date default null)
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
    'registeredUnique', (select count(distinct sub_no) from records),
    'validUnique', (select count(distinct r.sub_no) from records r
                     where exists (select 1 from subs s where s.sub_no = r.sub_no)),
    'totalRows', (select count(*) from records),
    'todayRows', (select count(*) from records where visit_date = current_date),
    'dupRows', (select count(*) from records where status = 'duplicate'),
    'nfRows', (select count(*) from records where status = 'not_found'),
    'bar', coalesce((select json_agg(x) from (
        select r.manager_id, count(distinct r.sub_no) as c from records r
        where r.visit_date between v_from and v_to
          and exists (select 1 from subs s where s.sub_no = r.sub_no)
        group by r.manager_id) x), '[]'::json),
    'line', coalesce((select json_agg(y) from (
        select r.visit_date as d, r.manager_id, count(distinct r.sub_no) as c from records r
        where r.visit_date between v_from and v_to
          and exists (select 1 from subs s where s.sub_no = r.sub_no)
        group by r.visit_date, r.manager_id order by r.visit_date) y), '[]'::json),
    'mgrStats', coalesce((select json_agg(z) from (
        select r.manager_id,
               count(*) as rows_n,
               count(*) filter (where r.status = 'duplicate') as dups,
               count(*) filter (where r.status = 'not_found') as nf,
               count(distinct r.sub_no) as uniq
        from records r
        where r.visit_date between v_from and v_to
        group by r.manager_id) z), '[]'::json)
  );
end $$;

-- محاسبه مجدد وضعیت‌ها (بعد از حذف فایل یا جایگزینی لیست)
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
  update uploads u set
    new_count = (select count(*) from records x where x.upload_id = u.id and x.status = 'new'),
    dup_count = (select count(*) from records x where x.upload_id = u.id and x.status = 'duplicate'),
    notfound_count = (select count(*) from records x where x.upload_id = u.id and x.status = 'not_found'),
    total = (select count(*) from records x where x.upload_id = u.id);
end $$;

-- حذف یک فایل آپلودشده + محاسبه مجدد
create or replace function public.delete_upload(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from uploads where id = p_id;   -- records با cascade حذف می‌شوند
  perform public.recompute_statuses();
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

-- ---------- دسترسی اجرای توابع فقط برای کاربران لاگین‌شده ----------
revoke all on function public.process_upload(text, bigint, date, jsonb, text) from public, anon;
revoke all on function public.dashboard_stats(date, date) from public, anon;
revoke all on function public.recompute_statuses() from public, anon;
revoke all on function public.delete_upload(bigint) from public, anon;
revoke all on function public.reset_all() from public, anon;

grant execute on function public.process_upload(text, bigint, date, jsonb, text) to authenticated;
grant execute on function public.dashboard_stats(date, date) to authenticated;
grant execute on function public.recompute_statuses() to authenticated;
grant execute on function public.delete_upload(bigint) to authenticated;
grant execute on function public.reset_all() to authenticated;

grant select, insert, update, delete on public.managers, public.subs, public.uploads, public.records to authenticated;
grant select on public.records_view, public.subs_view to authenticated;
grant usage on all sequences in schema public to authenticated;

-- پایان ✅ حالا از بخش Authentication → Users کاربر ادمین بسازید
