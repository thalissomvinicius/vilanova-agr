create extension if not exists "pgcrypto";

create table if not exists public.field_deposits (
  id uuid primary key,
  driver_registration text not null,
  driver_name text,
  vehicle_plate text not null,
  subproduct text not null,
  loading_origin text,
  scale_ticket_code text,
  farm text not null,
  placement_mode text not null check (placement_mode in ('single_plot', 'between_plots')),
  plot_primary text not null,
  plot_secondary text,
  deposit_date date not null,
  deposit_time time not null,
  latitude numeric,
  longitude numeric,
  location_accuracy numeric,
  dump_photo_data_url text,
  dump_photo_storage_path text,
  dump_photo_name text,
  dump_photo_latitude numeric,
  dump_photo_longitude numeric,
  dump_photo_accuracy numeric,
  dump_photo_captured_at timestamptz,
  notes text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_by_label text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  client_synced_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid()
);

create table if not exists public.inventario_parcelas (
  id uuid primary key default gen_random_uuid(),
  nome_fazenda text not null,
  parcela text not null,
  bloco text,
  ano_plantio integer,
  cultivar text,
  area_ha numeric,
  plantas integer,
  ativo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (nome_fazenda, parcela)
);

create table if not exists public.scale_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  field_deposit_id uuid references public.field_deposits(id),
  driver_registration text not null,
  driver_name text,
  vehicle_plate text not null,
  subproduct text not null,
  gross_weight_kg numeric not null check (gross_weight_kg >= 0),
  tare_weight_kg numeric not null check (tare_weight_kg >= 0),
  net_weight_kg numeric generated always as (gross_weight_kg - tare_weight_kg) stored,
  departure_at timestamptz not null,
  return_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.field_deposit_tombstones (
  source_response_id text primary key,
  field_deposit_id uuid,
  deleted_at timestamptz not null default now(),
  deleted_by text,
  reason text
);

alter table public.field_deposits
  add column if not exists loading_origin text;

alter table public.field_deposits
  add column if not exists dump_photo_data_url text,
  add column if not exists dump_photo_storage_path text,
  add column if not exists dump_photo_name text,
  add column if not exists dump_photo_latitude numeric,
  add column if not exists dump_photo_longitude numeric,
  add column if not exists dump_photo_accuracy numeric,
  add column if not exists dump_photo_captured_at timestamptz;

alter table public.field_deposits
  add column if not exists review_status text not null default 'pending',
  add column if not exists review_notes text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_by_label text;

update public.field_deposits
set review_status = 'pending'
where review_status is null;

alter table public.field_deposits
  alter column review_status set default 'pending',
  alter column review_status set not null;

alter table public.field_deposits
  drop constraint if exists field_deposits_review_status_check;

alter table public.field_deposits
  add constraint field_deposits_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));

create index if not exists field_deposits_date_idx on public.field_deposits (deposit_date desc);
create index if not exists field_deposits_vehicle_idx on public.field_deposits (vehicle_plate);
create index if not exists field_deposits_farm_idx on public.field_deposits (farm);
create index if not exists field_deposits_ticket_idx on public.field_deposits (scale_ticket_code);
create index if not exists field_deposits_review_status_idx on public.field_deposits (review_status);
create index if not exists inventario_parcelas_farm_idx on public.inventario_parcelas (nome_fazenda, ativo);
create index if not exists scale_tickets_ticket_idx on public.scale_tickets (ticket_code);
create index if not exists scale_tickets_vehicle_idx on public.scale_tickets (vehicle_plate);
create index if not exists scale_tickets_field_deposit_idx on public.scale_tickets (field_deposit_id);

alter table public.field_deposits enable row level security;
alter table public.inventario_parcelas enable row level security;
alter table public.scale_tickets enable row level security;

drop policy if exists "authenticated users can insert field deposits" on public.field_deposits;
drop policy if exists "authenticated users can update own field deposits" on public.field_deposits;
drop policy if exists "authenticated users can review field deposits" on public.field_deposits;
drop policy if exists "authenticated users can read field deposits" on public.field_deposits;
drop policy if exists "authenticated users can read inventory parcels" on public.inventario_parcelas;
drop policy if exists "authenticated users can read scale tickets" on public.scale_tickets;

create policy "authenticated users can insert field deposits"
on public.field_deposits
for insert
to authenticated
with check (created_by = auth.uid());

create policy "authenticated users can update own field deposits"
on public.field_deposits
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "authenticated users can review field deposits"
on public.field_deposits
for update
to authenticated
using (true)
with check (true);

create policy "authenticated users can read field deposits"
on public.field_deposits
for select
to authenticated
using (true);

create policy "authenticated users can read inventory parcels"
on public.inventario_parcelas
for select
to authenticated
using (ativo = true);

create policy "authenticated users can read scale tickets"
on public.scale_tickets
for select
to authenticated
using (true);

create or replace view public.subproduct_dashboard as
select
  fd.id,
  fd.deposit_date,
  fd.deposit_time,
  fd.driver_registration,
  fd.driver_name,
  fd.vehicle_plate,
  fd.subproduct,
  fd.loading_origin,
  fd.scale_ticket_code as field_ticket_code,
  fd.farm,
  fd.placement_mode,
  fd.plot_primary,
  fd.plot_secondary,
  case
    when fd.placement_mode = 'between_plots' then concat_ws(' / ', fd.plot_primary, nullif(fd.plot_secondary, ''))
    else fd.plot_primary
  end as plot_label,
  fd.latitude,
  fd.longitude,
  fd.location_accuracy,
  fd.dump_photo_data_url,
  fd.dump_photo_storage_path,
  fd.dump_photo_name,
  fd.dump_photo_latitude,
  fd.dump_photo_longitude,
  fd.dump_photo_accuracy,
  fd.dump_photo_captured_at,
  fd.notes,
  fd.review_status,
  fd.review_notes,
  fd.reviewed_at,
  fd.reviewed_by,
  fd.reviewed_by_label,
  fd.created_at,
  fd.updated_at,
  fd.client_synced_at,
  st.id as scale_ticket_id,
  st.ticket_code,
  st.gross_weight_kg,
  st.tare_weight_kg,
  st.net_weight_kg,
  st.departure_at,
  st.return_at,
  case
    when st.return_at is null then null
    else extract(epoch from (st.return_at - st.departure_at)) / 60
  end as cycle_minutes,
  case
    when st.id is null then 'aguardando_ticket'
    else 'conciliado'
  end as reconciliation_status
from public.field_deposits fd
left join lateral (
  select scale.*
  from public.scale_tickets scale
  where scale.field_deposit_id = fd.id
    or (
      fd.scale_ticket_code is not null
      and lower(scale.ticket_code) = lower(fd.scale_ticket_code)
    )
  order by
    case when scale.field_deposit_id = fd.id then 0 else 1 end,
    scale.created_at desc
  limit 1
) st on true;

create or replace view public.vw_dashboard_subprodutos as
select *
from public.subproduct_dashboard;
