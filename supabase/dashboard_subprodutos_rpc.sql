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
