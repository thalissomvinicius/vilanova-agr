-- Opcional para projetos que usam o login por matricula do dashboard antigo.
-- Requer que as funcoes dashboard_authenticate/dashboard_session_profile ja existam.

create or replace function public.dashboard_subproduct_snapshot(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_rows jsonb := '[]'::jsonb;
begin
  select *
  into v_actor
  from public.dashboard_session_profile(p_session_token)
  limit 1;

  if v_actor.matricula is null then
    raise exception 'Sessao expirada, invalida ou sem permissao.';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(dash) order by dash.deposit_date desc, dash.deposit_time desc),
    '[]'::jsonb
  )
  into v_rows
  from public.vw_dashboard_subprodutos dash;

  return jsonb_build_object(
    'rows', v_rows,
    'actor', jsonb_build_object(
      'matricula', v_actor.matricula,
      'nome', v_actor.nome,
      'role', v_actor.role
    )
  );
end;
$$;

revoke all on function public.dashboard_subproduct_snapshot(text) from public;
grant execute on function public.dashboard_subproduct_snapshot(text) to anon, authenticated;

comment on function public.dashboard_subproduct_snapshot(text) is
  'Returns the Subprodutos dashboard view for an active dashboard session token.';

create or replace function public.dashboard_review_subproduct_deposit(
  p_session_token text,
  p_deposit_id uuid,
  p_review_status text,
  p_review_notes text default null
)
returns table (
  id uuid,
  review_status text,
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by_label text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_status text := lower(trim(coalesce(p_review_status, 'pending')));
  v_reviewed_at timestamptz := now();
  v_reviewed_by_label text;
begin
  select *
  into v_actor
  from public.dashboard_session_profile(p_session_token)
  limit 1;

  if v_actor.matricula is null then
    raise exception 'Sessao expirada, invalida ou sem permissao.';
  end if;

  if v_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Status de validacao invalido.';
  end if;

  if v_status = 'pending' then
    v_reviewed_at := null;
    v_reviewed_by_label := null;
  else
    v_reviewed_by_label := concat_ws(' ', nullif(v_actor.nome, ''), concat('(', v_actor.matricula, ')'));
  end if;

  return query
  update public.field_deposits fd
  set
    review_status = v_status,
    review_notes = nullif(trim(coalesce(p_review_notes, '')), ''),
    reviewed_at = v_reviewed_at,
    reviewed_by_label = v_reviewed_by_label,
    updated_at = now()
  where fd.id = p_deposit_id
  returning
    fd.id,
    fd.review_status,
    fd.review_notes,
    fd.reviewed_at,
    fd.reviewed_by_label;
end;
$$;

revoke all on function public.dashboard_review_subproduct_deposit(text, uuid, text, text) from public;
grant execute on function public.dashboard_review_subproduct_deposit(text, uuid, text, text) to anon, authenticated;

comment on function public.dashboard_review_subproduct_deposit(text, uuid, text, text) is
  'Approves or rejects a Subprodutos field deposit using an active dashboard session token.';

create or replace function public.dashboard_delete_subproduct_deposit(
  p_session_token text,
  p_deposit_id uuid
)
returns table (
  id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_deleted_id uuid;
  v_source_response_id text;
begin
  select *
  into v_actor
  from public.dashboard_session_profile(p_session_token)
  limit 1;

  if v_actor.matricula is null then
    raise exception 'Sessao expirada, invalida ou sem permissao.';
  end if;

  update public.scale_tickets
  set field_deposit_id = null
  where field_deposit_id = p_deposit_id;

  select fd.source_response_id
  into v_source_response_id
  from public.field_deposits fd
  where fd.id = p_deposit_id
    and fd.review_status = 'rejected';

  delete from public.field_deposits fd
  where fd.id = p_deposit_id
    and fd.review_status = 'rejected'
  returning fd.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Coleta nao encontrada ou ainda nao reprovada.';
  end if;

  if v_source_response_id is not null then
    insert into public.field_deposit_tombstones (
      source_response_id,
      field_deposit_id,
      deleted_at,
      deleted_by,
      reason
    ) values (
      v_source_response_id,
      v_deleted_id,
      now(),
      concat_ws(' ', nullif(v_actor.nome, ''), concat('(', v_actor.matricula, ')')),
      'Excluida no dashboard depois de reprovada'
    ) on conflict (source_response_id) do update set
      field_deposit_id = excluded.field_deposit_id,
      deleted_at = excluded.deleted_at,
      deleted_by = excluded.deleted_by,
      reason = excluded.reason;
  end if;

  return query select v_deleted_id;
end;
$$;

revoke all on function public.dashboard_delete_subproduct_deposit(text, uuid) from public;
grant execute on function public.dashboard_delete_subproduct_deposit(text, uuid) to anon, authenticated;

comment on function public.dashboard_delete_subproduct_deposit(text, uuid) is
  'Deletes a rejected Subprodutos field deposit using an active dashboard session token.';

create or replace function public.dashboard_update_subproduct_deposit(
  p_session_token text,
  p_deposit_id uuid,
  p_patch jsonb
)
returns table (
  id uuid,
  driver_registration text,
  driver_name text,
  vehicle_plate text,
  subproduct text,
  loading_origin text,
  scale_ticket_code text,
  farm text,
  placement_mode text,
  plot_primary text,
  plot_secondary text,
  deposit_date date,
  deposit_time time,
  latitude numeric,
  longitude numeric,
  location_accuracy numeric,
  notes text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_placement text := lower(trim(coalesce(p_patch->>'placement_mode', 'single_plot')));
begin
  select *
  into v_actor
  from public.dashboard_session_profile(p_session_token)
  limit 1;

  if v_actor.matricula is null then
    raise exception 'Sessao expirada, invalida ou sem permissao.';
  end if;

  if v_placement not in ('single_plot', 'between_plots') then
    raise exception 'Modo de aplicacao invalido.';
  end if;

  if nullif(trim(coalesce(p_patch->>'driver_registration', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'driver_name', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'vehicle_plate', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'subproduct', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'loading_origin', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'scale_ticket_code', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'farm', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'plot_primary', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'deposit_date', '')), '') is null
    or nullif(trim(coalesce(p_patch->>'deposit_time', '')), '') is null then
    raise exception 'Campos obrigatorios incompletos.';
  end if;

  if v_placement = 'between_plots'
    and nullif(trim(coalesce(p_patch->>'plot_secondary', '')), '') is null then
    raise exception 'Informe a segunda parcela.';
  end if;

  return query
  update public.field_deposits fd
  set
    driver_registration = trim(p_patch->>'driver_registration'),
    driver_name = trim(p_patch->>'driver_name'),
    vehicle_plate = upper(trim(p_patch->>'vehicle_plate')),
    subproduct = trim(p_patch->>'subproduct'),
    loading_origin = trim(p_patch->>'loading_origin'),
    scale_ticket_code = upper(trim(p_patch->>'scale_ticket_code')),
    farm = trim(p_patch->>'farm'),
    placement_mode = v_placement,
    plot_primary = upper(trim(p_patch->>'plot_primary')),
    plot_secondary = case
      when v_placement = 'between_plots' then upper(trim(p_patch->>'plot_secondary'))
      else ''
    end,
    deposit_date = (p_patch->>'deposit_date')::date,
    deposit_time = (p_patch->>'deposit_time')::time,
    latitude = nullif(trim(coalesce(p_patch->>'latitude', '')), '')::numeric,
    longitude = nullif(trim(coalesce(p_patch->>'longitude', '')), '')::numeric,
    location_accuracy = nullif(trim(coalesce(p_patch->>'location_accuracy', '')), '')::numeric,
    notes = nullif(trim(coalesce(p_patch->>'notes', '')), ''),
    source_updated_at = now(),
    updated_at = now()
  where fd.id = p_deposit_id
  returning
    fd.id,
    fd.driver_registration,
    fd.driver_name,
    fd.vehicle_plate,
    fd.subproduct,
    fd.loading_origin,
    fd.scale_ticket_code,
    fd.farm,
    fd.placement_mode,
    fd.plot_primary,
    fd.plot_secondary,
    fd.deposit_date,
    fd.deposit_time,
    fd.latitude,
    fd.longitude,
    fd.location_accuracy,
    fd.notes,
    fd.updated_at;
end;
$$;

revoke all on function public.dashboard_update_subproduct_deposit(text, uuid, jsonb) from public;
grant execute on function public.dashboard_update_subproduct_deposit(text, uuid, jsonb) to anon, authenticated;

comment on function public.dashboard_update_subproduct_deposit(text, uuid, jsonb) is
  'Edits a Subprodutos field deposit using an active dashboard session token.';
