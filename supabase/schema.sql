-- Compatibilidade com o modelo JSON do MVP; somente o backend acessa estas tabelas.
-- Mantém a ordenação original e detecta gravações concorrentes de outra instância.
create table public.cm_controle (
  nome text primary key,
  revisao bigint not null default 0 check (revisao >= 0)
);
alter table public.cm_controle enable row level security;
revoke all on public.cm_controle from public, anon, authenticated;
grant select, update on public.cm_controle to service_role;
create policy backend_only on public.cm_controle to service_role using (true) with check (true);

create table public.cm_usuarios (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_usuarios enable row level security;
revoke all on public.cm_usuarios from public, anon, authenticated;
grant select, insert, update, delete on public.cm_usuarios to service_role;
grant usage, select on sequence public.cm_usuarios_ordem_seq to service_role;
create policy backend_only on public.cm_usuarios to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('usuarios');

create table public.cm_prestadores (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_prestadores enable row level security;
revoke all on public.cm_prestadores from public, anon, authenticated;
grant select, insert, update, delete on public.cm_prestadores to service_role;
grant usage, select on sequence public.cm_prestadores_ordem_seq to service_role;
create policy backend_only on public.cm_prestadores to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('prestadores');

create table public.cm_clientes (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_clientes enable row level security;
revoke all on public.cm_clientes from public, anon, authenticated;
grant select, insert, update, delete on public.cm_clientes to service_role;
grant usage, select on sequence public.cm_clientes_ordem_seq to service_role;
create policy backend_only on public.cm_clientes to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('clientes');

create table public.cm_solicitacoes (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_solicitacoes enable row level security;
revoke all on public.cm_solicitacoes from public, anon, authenticated;
grant select, insert, update, delete on public.cm_solicitacoes to service_role;
grant usage, select on sequence public.cm_solicitacoes_ordem_seq to service_role;
create policy backend_only on public.cm_solicitacoes to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('solicitacoes');

create table public.cm_mensagens (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_mensagens enable row level security;
revoke all on public.cm_mensagens from public, anon, authenticated;
grant select, insert, update, delete on public.cm_mensagens to service_role;
grant usage, select on sequence public.cm_mensagens_ordem_seq to service_role;
create policy backend_only on public.cm_mensagens to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('mensagens');

create table public.cm_avaliacoes (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_avaliacoes enable row level security;
revoke all on public.cm_avaliacoes from public, anon, authenticated;
grant select, insert, update, delete on public.cm_avaliacoes to service_role;
grant usage, select on sequence public.cm_avaliacoes_ordem_seq to service_role;
create policy backend_only on public.cm_avaliacoes to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('avaliacoes');

create table public.cm_notificacoes (
  id text primary key,
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and dados ? 'id' and dados->>'id' = id),
  ordem bigint generated always as identity unique
);
alter table public.cm_notificacoes enable row level security;
revoke all on public.cm_notificacoes from public, anon, authenticated;
grant select, insert, update, delete on public.cm_notificacoes to service_role;
grant usage, select on sequence public.cm_notificacoes_ordem_seq to service_role;
create policy backend_only on public.cm_notificacoes to service_role using (true) with check (true);
insert into public.cm_controle (nome) values ('notificacoes');

create function public.cm_ler_base() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare c record; registros jsonb; resultado jsonb := '{}'::jsonb;
begin
  for c in select nome, revisao from public.cm_controle order by nome loop
    execute format('select coalesce(jsonb_agg(dados order by ordem), ''[]''::jsonb) from public.%I', 'cm_' || c.nome) into registros;
    resultado := resultado || jsonb_build_object(c.nome, jsonb_build_object('revisao', c.revisao, 'registros', registros));
  end loop;
  return resultado;
end;
$$;
revoke all on function public.cm_ler_base() from public, anon, authenticated;
grant execute on function public.cm_ler_base() to service_role;

create function public.cm_gravar_colecao(colecao text, revisao_esperada bigint, registros jsonb) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare atual bigint;
begin
  select revisao into atual from public.cm_controle where nome = colecao for update;
  if not found then raise exception 'Colecao invalida' using errcode = '22023'; end if;
  if atual <> revisao_esperada then
    raise exception 'Base alterada por outra instancia. Reinicie o servidor para recarregar os dados.' using errcode = '40001';
  end if;
  if jsonb_typeof(registros) is distinct from 'array' then raise exception 'Registros devem ser uma lista' using errcode = '22023'; end if;
  if exists(select 1 from jsonb_array_elements(registros) r where jsonb_typeof(r) <> 'object' or coalesce(r->>'id', '') = '') then
    raise exception 'Registro sem identificador' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(registros)) <> (select count(distinct r->>'id') from jsonb_array_elements(registros) r) then
    raise exception 'Identificadores duplicados' using errcode = '22023';
  end if;
  execute format(
    'insert into public.%I (id, dados) select r->>''id'', r from jsonb_array_elements($1) r
     on conflict (id) do update set dados = excluded.dados where %I.dados is distinct from excluded.dados',
    'cm_' || colecao, 'cm_' || colecao
  ) using registros;
  execute format('delete from public.%I where not (id in (select r->>''id'' from jsonb_array_elements($1) r))', 'cm_' || colecao) using registros;
  update public.cm_controle set revisao = atual + 1 where nome = colecao;
  return atual + 1;
end;
$$;
revoke all on function public.cm_gravar_colecao(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.cm_gravar_colecao(text, bigint, jsonb) to service_role;

-- Importação inicial atômica: recusa banco já usado e nunca substitui dados existentes.
create function public.cm_importar_base(base jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare c record;
begin
  perform 1 from public.cm_controle order by nome for update;
  if exists(select 1 from public.cm_controle where revisao <> 0) then
    raise exception 'Importacao recusada: banco ja utilizado' using errcode = '40001';
  end if;
  if jsonb_typeof(base) is distinct from 'object' or (select count(*) from jsonb_object_keys(base)) <> 7 then
    raise exception 'Base incompleta' using errcode = '22023';
  end if;
  for c in select nome from public.cm_controle order by nome loop
    if not (base ? c.nome) then raise exception 'Colecao ausente' using errcode = '22023'; end if;
    perform public.cm_gravar_colecao(c.nome, 0, base->c.nome);
  end loop;
end;
$$;
revoke all on function public.cm_importar_base(jsonb) from public, anon, authenticated;
grant execute on function public.cm_importar_base(jsonb) to service_role;
notify pgrst, 'reload schema';

