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
