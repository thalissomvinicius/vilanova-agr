-- Ponte entre o app mobile de Subprodutos e o dashboard.
-- Rode este arquivo no SQL Editor do Supabase depois de `schema.sql`.

alter table public.field_deposits
  add column if not exists source_response_id text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists payload_hash text,
  add column if not exists dump_photo_storage_path text;

create index if not exists field_deposits_source_response_idx
  on public.field_deposits (source_response_id);

create or replace function public.mobile_subproduct_uuid(p_source_response_id text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5('mobile_subproduct:' || coalesce(p_source_response_id, '')), 1, 8) || '-' ||
    substr(md5('mobile_subproduct:' || coalesce(p_source_response_id, '')), 9, 4) || '-' ||
    substr(md5('mobile_subproduct:' || coalesce(p_source_response_id, '')), 13, 4) || '-' ||
    substr(md5('mobile_subproduct:' || coalesce(p_source_response_id, '')), 17, 4) || '-' ||
    substr(md5('mobile_subproduct:' || coalesce(p_source_response_id, '')), 21, 12)
  )::uuid;
$$;

create or replace function public.mobile_sync_subproduct_deposits(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_received integer := 0;
  v_synced integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Payload invalido para sincronizar despejos de subprodutos.';
  end if;

  select count(*)
  into v_received
  from jsonb_array_elements(p_rows);

  with raw_rows as (
    select value as row_data
    from jsonb_array_elements(p_rows)
  ),
  normalized as (
    select
      nullif(trim(row_data->>'source_response_id'), '') as source_response_id,
      upper(nullif(trim(row_data->>'driver_registration'), '')) as driver_registration,
      nullif(trim(row_data->>'driver_name'), '') as driver_name,
      upper(nullif(trim(row_data->>'vehicle_plate'), '')) as vehicle_plate,
      nullif(trim(row_data->>'subproduct'), '') as subproduct,
      nullif(trim(row_data->>'loading_origin'), '') as loading_origin,
      upper(nullif(trim(row_data->>'scale_ticket_code'), '')) as scale_ticket_code,
      nullif(trim(row_data->>'farm'), '') as farm,
      case
        when lower(trim(coalesce(row_data->>'placement_mode', ''))) = 'between_plots' then 'between_plots'
        else 'single_plot'
      end as placement_mode,
      upper(nullif(trim(row_data->>'plot_primary'), '')) as plot_primary,
      upper(nullif(trim(row_data->>'plot_secondary'), '')) as plot_secondary,
      case
        when trim(coalesce(row_data->>'deposit_date', '')) ~ '^\d{4}-\d{2}-\d{2}$'
          then (row_data->>'deposit_date')::date
        when trim(coalesce(row_data->>'deposit_date', '')) ~ '^\d{2}/\d{2}/\d{4}$'
          then to_date(row_data->>'deposit_date', 'DD/MM/YYYY')
        else current_date
      end as deposit_date,
      case
        when trim(coalesce(row_data->>'deposit_time', '')) ~ '^\d{2}:\d{2}(:\d{2})?$'
          then (row_data->>'deposit_time')::time
        else localtime(0)
      end as deposit_time,
      case
        when trim(coalesce(row_data->>'latitude', '')) ~ '^-?\d+(\.\d+)?$'
          then (row_data->>'latitude')::numeric
        else null
      end as latitude,
      case
        when trim(coalesce(row_data->>'longitude', '')) ~ '^-?\d+(\.\d+)?$'
          then (row_data->>'longitude')::numeric
        else null
      end as longitude,
      case
        when trim(coalesce(row_data->>'location_accuracy', '')) ~ '^\d+(\.\d+)?$'
          then (row_data->>'location_accuracy')::numeric
        else null
      end as location_accuracy,
      nullif(trim(row_data->>'dump_photo_data_url'), '') as dump_photo_data_url,
      nullif(trim(row_data->>'dump_photo_storage_path'), '') as dump_photo_storage_path,
      nullif(trim(row_data->>'dump_photo_name'), '') as dump_photo_name,
      case
        when trim(coalesce(row_data->>'dump_photo_latitude', '')) ~ '^-?\d+(\.\d+)?$'
          then (row_data->>'dump_photo_latitude')::numeric
        else null
      end as dump_photo_latitude,
      case
        when trim(coalesce(row_data->>'dump_photo_longitude', '')) ~ '^-?\d+(\.\d+)?$'
          then (row_data->>'dump_photo_longitude')::numeric
        else null
      end as dump_photo_longitude,
      case
        when trim(coalesce(row_data->>'dump_photo_accuracy', '')) ~ '^\d+(\.\d+)?$'
          then (row_data->>'dump_photo_accuracy')::numeric
        else null
      end as dump_photo_accuracy,
      case
        when nullif(trim(row_data->>'dump_photo_captured_at'), '') is not null
          then (row_data->>'dump_photo_captured_at')::timestamptz
        else null
      end as dump_photo_captured_at,
      nullif(trim(row_data->>'notes'), '') as notes,
      coalesce(nullif(trim(row_data->>'created_at'), '')::timestamptz, now()) as created_at,
      coalesce(nullif(trim(row_data->>'updated_at'), '')::timestamptz, now()) as updated_at,
      coalesce(nullif(trim(row_data->>'client_synced_at'), '')::timestamptz, now()) as client_synced_at,
      coalesce(
        nullif(trim(row_data->>'source_updated_at'), '')::timestamptz,
        nullif(trim(row_data->>'updated_at'), '')::timestamptz,
        nullif(trim(row_data->>'created_at'), '')::timestamptz,
        now()
      ) as source_updated_at,
      md5(row_data::text) as payload_hash
    from raw_rows
  ),
  valid_rows as (
    select normalized.*
    from normalized
    where normalized.source_response_id is not null
      and normalized.driver_registration is not null
      and normalized.vehicle_plate is not null
      and normalized.subproduct is not null
      and normalized.farm is not null
      and normalized.plot_primary is not null
      and not exists (
        select 1
        from public.field_deposit_tombstones tombstone
        where tombstone.source_response_id = normalized.source_response_id
      )
  ),
  upserted as (
    insert into public.field_deposits (
      id,
      source_response_id,
      driver_registration,
      driver_name,
      vehicle_plate,
      subproduct,
      loading_origin,
      scale_ticket_code,
      farm,
      placement_mode,
      plot_primary,
      plot_secondary,
      deposit_date,
      deposit_time,
      latitude,
      longitude,
      location_accuracy,
      dump_photo_data_url,
      dump_photo_storage_path,
      dump_photo_name,
      dump_photo_latitude,
      dump_photo_longitude,
      dump_photo_accuracy,
      dump_photo_captured_at,
      notes,
      created_at,
      updated_at,
      client_synced_at,
      source_updated_at,
      payload_hash,
      review_status
    )
    select
      public.mobile_subproduct_uuid(source_response_id),
      source_response_id,
      driver_registration,
      driver_name,
      vehicle_plate,
      subproduct,
      loading_origin,
      scale_ticket_code,
      farm,
      placement_mode,
      plot_primary,
      case when placement_mode = 'between_plots' then plot_secondary else null end,
      deposit_date,
      deposit_time,
      latitude,
      longitude,
      location_accuracy,
      dump_photo_data_url,
      dump_photo_storage_path,
      dump_photo_name,
      dump_photo_latitude,
      dump_photo_longitude,
      dump_photo_accuracy,
      dump_photo_captured_at,
      notes,
      created_at,
      updated_at,
      client_synced_at,
      source_updated_at,
      payload_hash,
      'pending'
    from valid_rows
    on conflict (id) do update
    set
      source_response_id = excluded.source_response_id,
      driver_registration = excluded.driver_registration,
      driver_name = excluded.driver_name,
      vehicle_plate = excluded.vehicle_plate,
      subproduct = excluded.subproduct,
      loading_origin = excluded.loading_origin,
      scale_ticket_code = excluded.scale_ticket_code,
      farm = excluded.farm,
      placement_mode = excluded.placement_mode,
      plot_primary = excluded.plot_primary,
      plot_secondary = excluded.plot_secondary,
      deposit_date = excluded.deposit_date,
      deposit_time = excluded.deposit_time,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_accuracy = excluded.location_accuracy,
      dump_photo_data_url = excluded.dump_photo_data_url,
      dump_photo_storage_path = excluded.dump_photo_storage_path,
      dump_photo_name = excluded.dump_photo_name,
      dump_photo_latitude = excluded.dump_photo_latitude,
      dump_photo_longitude = excluded.dump_photo_longitude,
      dump_photo_accuracy = excluded.dump_photo_accuracy,
      dump_photo_captured_at = excluded.dump_photo_captured_at,
      notes = excluded.notes,
      updated_at = excluded.updated_at,
      client_synced_at = excluded.client_synced_at,
      source_updated_at = excluded.source_updated_at,
      payload_hash = excluded.payload_hash
    where excluded.source_updated_at >= coalesce(public.field_deposits.source_updated_at, '-infinity'::timestamptz)
    returning 1
  )
  select count(*)
  into v_synced
  from upserted;

  return jsonb_build_object(
    'received', v_received,
    'synced', v_synced,
    'skipped', greatest(v_received - v_synced, 0)
  );
end;
$$;

revoke all on function public.mobile_subproduct_uuid(text) from public;
grant execute on function public.mobile_subproduct_uuid(text) to anon, authenticated;

revoke all on function public.mobile_sync_subproduct_deposits(jsonb) from public;
revoke all on function public.mobile_sync_subproduct_deposits(jsonb) from anon, authenticated;
grant execute on function public.mobile_sync_subproduct_deposits(jsonb) to service_role;

comment on function public.mobile_sync_subproduct_deposits(jsonb) is
  'Receives subproduct unload records from the offline mobile app and upserts them into field_deposits for dashboard review.';
