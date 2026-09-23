-- =========================================================
-- BoxPro — schema do banco (rodar inteiro no SQL Editor de um projeto Supabase NOVO)
-- Multi-tenant: cada "oficina" (assinante) é isolada por RLS.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- TABELAS ----------

create table if not exists oficinas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text unique not null,
  name text not null default 'Minha Oficina',
  segmento text not null default 'ambos' check (segmento in ('carros','motos','ambos')),
  logo_url text,
  whatsapp text,
  brand_color text not null default '#D9FF3F',
  fundo_estilo text not null default 'escuro' check (fundo_estilo in ('escuro','carbono')),
  subscription_status text not null default 'trial' check (subscription_status in ('trial','ativo','inadimplente','cancelado')),
  subscription_plan text,
  mp_preapproval_id text,
  created_at timestamptz default now()
);

create table if not exists mecanicos (
  id uuid primary key default gen_random_uuid(),
  oficina_id uuid not null references oficinas(id) on delete cascade,
  nome text not null,
  especialidade text,
  cor text not null default '#D9FF3F',
  created_at timestamptz default now()
);

create table if not exists servicos (
  id uuid primary key default gen_random_uuid(),
  oficina_id uuid not null references oficinas(id) on delete cascade,
  nome text not null,
  preco_base numeric(10,2) not null default 0,
  duracao_min int not null default 60,
  created_at timestamptz default now()
);

create table if not exists ordens_servico (
  id uuid primary key default gen_random_uuid(),
  oficina_id uuid not null references oficinas(id) on delete cascade,
  mecanico_id uuid references mecanicos(id) on delete set null,
  servico_id uuid references servicos(id) on delete set null,
  cliente_nome text not null,
  cliente_telefone text not null,
  veiculo_tipo text not null default 'carro' check (veiculo_tipo in ('carro','moto')),
  veiculo_placa text,
  veiculo_modelo text,
  veiculo_ano text,
  veiculo_km text,
  checkin_detalhes text,
  data date not null,
  horario time not null,
  status text not null default 'recebido' check (status in ('recebido','orcamento','aprovado','em_servico','pronto','entregue','cancelado')),
  valor_orcamento numeric(10,2),
  valor_final numeric(10,2),
  pago boolean not null default false,
  mp_link text,
  created_at timestamptz default now()
);

create table if not exists patrocinadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text,
  link_url text,
  ativo boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_mecanicos_oficina on mecanicos(oficina_id);
create index if not exists idx_servicos_oficina on servicos(oficina_id);
create index if not exists idx_os_oficina on ordens_servico(oficina_id);
create index if not exists idx_os_status on ordens_servico(oficina_id, status);
create index if not exists idx_oficina_mp on oficinas(mp_preapproval_id);

-- ---------- ROW LEVEL SECURITY ----------

alter table oficinas enable row level security;
alter table mecanicos enable row level security;
alter table servicos enable row level security;
alter table ordens_servico enable row level security;
alter table patrocinadores enable row level security;

create policy "owner manages oficina" on oficinas
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "public can read oficina" on oficinas
  for select using (true);

create policy "owner manages mecanicos" on mecanicos
  for all using (exists (select 1 from oficinas o where o.id = mecanicos.oficina_id and o.owner_id = auth.uid()))
  with check (exists (select 1 from oficinas o where o.id = mecanicos.oficina_id and o.owner_id = auth.uid()));
create policy "public can read mecanicos" on mecanicos
  for select using (true);

create policy "owner manages servicos" on servicos
  for all using (exists (select 1 from oficinas o where o.id = servicos.oficina_id and o.owner_id = auth.uid()))
  with check (exists (select 1 from oficinas o where o.id = servicos.oficina_id and o.owner_id = auth.uid()));
create policy "public can read servicos" on servicos
  for select using (true);

create policy "owner manages ordens" on ordens_servico
  for all using (exists (select 1 from oficinas o where o.id = ordens_servico.oficina_id and o.owner_id = auth.uid()))
  with check (exists (select 1 from oficinas o where o.id = ordens_servico.oficina_id and o.owner_id = auth.uid()));
create policy "public can create ordem" on ordens_servico
  for insert with check (status = 'recebido');

create policy "public can read patrocinadores ativos" on patrocinadores
  for select using (ativo = true);

-- ---------- STORAGE (logo do assinante) ----------
-- Crie um bucket público chamado "logos" (Storage → New bucket → Public bucket = ON), se ainda não existir.
-- Sem as políticas abaixo, o upload falha com "new row violates row-level security policy".

create policy "dono envia logo da propria oficina" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and exists (select 1 from oficinas o where o.owner_id = auth.uid() and o.id::text = (storage.foldername(name))[1])
  );

create policy "dono atualiza logo da propria oficina" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and exists (select 1 from oficinas o where o.owner_id = auth.uid() and o.id::text = (storage.foldername(name))[1])
  );

create policy "qualquer um pode ver os logos" on storage.objects
  for select using (bucket_id = 'logos');

-- ---------- APROVAÇÃO DE ORÇAMENTO PELO CLIENTE (link público, sem expor a tabela toda) ----------
-- O cliente recebe um link (aprovar.html?id=<ordem_id>) e aprova/recusa sem precisar ligar.
-- Funções "security definer" expõem só o necessário, sem abrir SELECT/UPDATE público na tabela.

create or replace function public.get_orcamento_publico(p_id uuid)
returns table(
  cliente_nome text,
  veiculo_tipo text,
  veiculo_modelo text,
  veiculo_placa text,
  valor_orcamento numeric,
  status text,
  oficina_nome text,
  oficina_cor text,
  oficina_logo text
)
language sql
security definer
set search_path = public
as $$
  select os.cliente_nome, os.veiculo_tipo, os.veiculo_modelo, os.veiculo_placa, os.valor_orcamento, os.status,
         o.name, o.brand_color, o.logo_url
  from ordens_servico os
  join oficinas o on o.id = os.oficina_id
  where os.id = p_id;
$$;

grant execute on function public.get_orcamento_publico(uuid) to anon, authenticated;

create or replace function public.responder_orcamento(p_id uuid, p_aprovado boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  novo_status text;
begin
  novo_status := case when p_aprovado then 'aprovado' else 'cancelado' end;
  update ordens_servico
  set status = novo_status
  where id = p_id and status = 'orcamento';
  if not found then
    return null;
  end if;
  return novo_status;
end;
$$;

grant execute on function public.responder_orcamento(uuid, boolean) to anon, authenticated;

-- ---------- MIGRAÇÃO: prazo do teste grátis (30 dias) ----------
alter table oficinas add column if not exists trial_expires_at timestamptz;
update oficinas set trial_expires_at = coalesce(trial_expires_at, created_at + interval '30 days');
alter table oficinas alter column trial_expires_at set default (now() + interval '30 days');
alter table oficinas alter column trial_expires_at set not null;
