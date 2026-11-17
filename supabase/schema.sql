-- =====================================================================
-- CONECTAcamp — banco de dados (Supabase / Postgres)
--
-- COMO USAR (quando você criar o projeto no Supabase):
--   1) Abra o projeto > SQL Editor > New query
--   2) Cole este arquivo inteiro e clique em Run
--   3) Authentication > Users > Add user: crie o usuário do organizador
--      (e-mail abaixo, com senha; marque "Auto confirm user")
--   4) Authentication > Sign In / Providers: desative "Allow new users to sign up"
--
-- É seguro rodar de novo: usa "if not exists" e "create or replace".
-- Nada aqui foi aplicado em nenhum projeto: este arquivo só existe localmente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id            int primary key default 1 check (id = 1),
  capacity      int not null default 100 check (capacity between 1 and 10000),
  price         numeric(10,2) not null default 150 check (price >= 0),
  age_min       int not null default 15 check (age_min between 0 and 99),
  age_max       int not null default 25 check (age_max between 0 and 120),
  count_pending boolean not null default true,   -- pré-cadastros ocupam vaga?
  open          boolean not null default true,   -- inscrições abertas no site?
  updated_at    timestamptz not null default now(),
  check (age_max >= age_min)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Quem pode entrar no painel (e-mails em minúsculas)
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
insert into public.admins (email) values ('josegabrielpo422@gmail.com') on conflict (email) do nothing;

create table if not exists public.registrations (
  id               uuid primary key default gen_random_uuid(),
  protocol         text not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  source           text not null default 'site' check (source in ('site', 'admin')),
  status           text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  accompanied      text not null default '' check (accompanied in ('', 'sim', 'nao')),
  auth_ack         boolean not null default false,  -- aceitou levar a autorização assinada
  auth_received    boolean not null default false,  -- organizador: autorização recebida
  consent_at       timestamptz,
  consent_by_admin boolean not null default false,
  amount           numeric(10,2) not null default 0,
  admin_note       text not null default ''
);

-- Forma de pagamento escolhida: pix e cartao = um único pagamento; crediario = várias parcelas
alter table public.registrations
  add column if not exists pay_plan text not null default '' check (pay_plan in ('', 'pix', 'cartao', 'crediario'));

create table if not exists public.participants (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  position        int not null default 0,
  nome            text not null,
  idade           int not null check (idade between 0 and 120),
  tel             text not null,
  igreja          text not null default '',
  obs             text not null default ''
);
create index if not exists participants_registration_idx on public.participants (registration_id);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  amount          numeric(10,2) not null check (amount > 0),
  method          text not null default 'Pix' check (method in ('Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro')),
  paid_on         date not null default current_date,
  note            text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists payments_registration_idx on public.payments (registration_id);

-- Controle de tentativas por IP (só as funções acessam)
create table if not exists public.rate_limits (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists rate_limits_key_idx on public.rate_limits (key, at);

-- Regras de pagamento (valem para qualquer caminho que grave pagamentos)
create or replace function public.enforce_payment_rules()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r public.registrations%rowtype;
  paid numeric;
  nome text;
begin
  -- usuário logado que não é admin: deixa a segurança por linha (RLS) barrar, sem revelar nem travar nada
  if auth.uid() is not null and not public.is_admin() then
    return new;
  end if;
  select * into r from public.registrations where id = new.registration_id for update;
  if r.pay_plan = '' then
    raise exception 'Escolha a forma de pagamento antes de registrar pagamentos.' using errcode = 'PT400';
  end if;
  nome := case r.pay_plan when 'pix' then 'Pix' when 'cartao' then 'Cartão de crédito' else 'Crediário' end;
  select coalesce(sum(amount), 0) into paid from public.payments where registration_id = new.registration_id;
  if r.pay_plan in ('pix', 'cartao') then
    if paid > 0 then
      raise exception '% permite um único pagamento, e ele já foi registrado.', nome using errcode = 'PT409';
    end if;
    if new.amount <> r.amount then
      raise exception '% é pago de uma vez só: R$ %.', nome, to_char(r.amount, 'FM999990.00') using errcode = 'PT400';
    end if;
  elsif paid + new.amount > r.amount then
    raise exception 'O pagamento passa do valor da inscrição (falta R$ %).', to_char(greatest(0, r.amount - paid), 'FM999990.00') using errcode = 'PT400';
  end if;
  return new;
end $$;

drop trigger if exists payments_rules on public.payments;
create trigger payments_rules before insert on public.payments
  for each row execute function public.enforce_payment_rules();

create or replace function public.enforce_plan_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  total numeric;
begin
  if new.pay_plan is distinct from old.pay_plan and new.pay_plan in ('pix', 'cartao') then
    select count(*), coalesce(sum(amount), 0) into n, total from public.payments where registration_id = new.id;
    if n > 1 then
      raise exception 'Há mais de um pagamento registrado. Remova até sobrar um, ou use Crediário.' using errcode = 'PT409';
    end if;
    if n = 1 and total <> new.amount then
      raise exception 'O pagamento registrado não cobre o valor total. Remova-o ou use Crediário.' using errcode = 'PT409';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists registrations_plan on public.registrations;
create trigger registrations_plan before update of pay_plan on public.registrations
  for each row execute function public.enforce_plan_change();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists registrations_touch on public.registrations;
create trigger registrations_touch before update on public.registrations
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Quem é administrador (e-mail confirmado e presente na tabela admins)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- ---------------------------------------------------------------------
-- Segurança por linha (RLS): só administradores leem/alteram as tabelas.
-- O público (anon) não acessa tabela nenhuma: só chama as funções abaixo.
-- ---------------------------------------------------------------------
alter table public.settings      enable row level security;
alter table public.admins        enable row level security;
alter table public.registrations enable row level security;
alter table public.participants  enable row level security;
alter table public.payments      enable row level security;
alter table public.rate_limits   enable row level security;

drop policy if exists "admin tudo" on public.registrations;
create policy "admin tudo" on public.registrations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin tudo" on public.participants;
create policy "admin tudo" on public.participants for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin tudo" on public.payments;
create policy "admin tudo" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin le e altera" on public.settings;
create policy "admin le e altera" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- admins e rate_limits: RLS ligado e nenhuma política = ninguém acessa direto.

revoke all on public.settings, public.admins, public.registrations, public.participants,
              public.payments, public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.registrations, public.participants, public.payments to authenticated;
grant select, update on public.settings to authenticated;

-- ---------------------------------------------------------------------
-- Funções internas (não ficam expostas na API)
-- ---------------------------------------------------------------------
create or replace function public.camp_taken()
returns int language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(
    (select count(*) from public.participants p where p.registration_id = r.id)
  ), 0)::int
  from public.registrations r
  cross join public.settings s
  where s.id = 1
    and r.status = 'ativa'
    and (s.count_pending or exists (select 1 from public.payments pay where pay.registration_id = r.id));
$$;

create or replace function public.camp_new_protocol()
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  p text;
  i int;
begin
  loop
    p := 'CC-';
    for i in 1..6 loop
      p := p || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.registrations where protocol = p);
  end loop;
  return p;
end $$;

create or replace function public.camp_validate_participants(p_list jsonb, p_enforce_age boolean)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.settings%rowtype;
  item jsonb;
  result jsonb := '[]'::jsonb;
  v_nome text; v_idade int; v_tel text; v_igreja text; v_obs text;
begin
  select * into s from public.settings where id = 1;
  if p_list is null or jsonb_typeof(p_list) <> 'array' or jsonb_array_length(p_list) not between 1 and 20 then
    raise exception 'Informe de 1 a 20 participantes.' using errcode = 'PT400';
  end if;
  for item in select value from jsonb_array_elements(p_list) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'Dados de participante inválidos.' using errcode = 'PT400';
    end if;
    v_nome   := left(btrim(regexp_replace(coalesce(item->>'nome', ''),   '[[:cntrl:][:space:]]+', ' ', 'g')), 100);
    v_tel    := left(btrim(regexp_replace(coalesce(item->>'tel', ''),    '[[:cntrl:][:space:]]+', ' ', 'g')), 30);
    v_igreja := left(btrim(regexp_replace(coalesce(item->>'igreja', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 100);
    v_obs    := left(btrim(regexp_replace(coalesce(item->>'obs', ''),    '[[:cntrl:][:space:]]+', ' ', 'g')), 200);
    v_idade  := case when (item->>'idade') ~ '^[0-9]{1,3}$' then (item->>'idade')::int else null end;
    if array_length(regexp_split_to_array(v_nome, ' '), 1) < 2 then
      raise exception 'Informe nome e sobrenome de cada participante.' using errcode = 'PT400';
    end if;
    if v_idade is null or v_idade > 120 then
      raise exception 'Idade inválida para %.', v_nome using errcode = 'PT400';
    end if;
    if p_enforce_age and (v_idade < s.age_min or v_idade > s.age_max) then
      raise exception 'O CONECTAcamp é para jovens de % a % anos (%).', s.age_min, s.age_max, v_nome using errcode = 'PT400';
    end if;
    if length(regexp_replace(v_tel, '[^0-9]', '', 'g')) < 10 then
      raise exception 'Informe um WhatsApp com DDD para %.', v_nome using errcode = 'PT400';
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'nome', v_nome, 'idade', v_idade, 'tel', v_tel, 'igreja', v_igreja, 'obs', v_obs));
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Funções públicas (o site chama estas duas, sem login)
-- ---------------------------------------------------------------------

-- Vagas ao vivo
create or replace function public.camp_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'capacity',  s.capacity,
    'taken',     t.taken,
    'remaining', greatest(0, s.capacity - t.taken),
    'price',     s.price,
    'ageMin',    s.age_min,
    'ageMax',    s.age_max,
    'open',      s.open)
  from public.settings s
  cross join (select public.camp_taken() as taken) t
  where s.id = 1;
$$;

-- Inscrição feita pelo site
create or replace function public.camp_register(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.settings%rowtype;
  parts jsonb;
  n int;
  has_minor boolean;
  acc text := '';
  auth boolean := false;
  taken int;
  rid uuid;
  proto text;
  hdr json;
  ip text := '';
  recent int;
begin
  -- campo-isca anti-robô: finge sucesso e não grava nada
  if coalesce(btrim(payload->>'hp'), '') <> '' then
    return jsonb_build_object('ok', true, 'protocol', 'CC-000000');
  end if;

  -- limite de inscrições por IP (8 por hora)
  begin
    hdr := current_setting('request.headers', true)::json;
  exception when others then
    hdr := null;
  end;
  ip := coalesce(btrim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), '');
  if ip <> '' then
    delete from public.rate_limits where at < now() - interval '1 day';
    select count(*) into recent from public.rate_limits
      where key = 'reg:' || ip and at > now() - interval '1 hour';
    if recent >= 8 then
      raise exception 'Muitas tentativas. Aguarde um pouco e tente de novo.' using errcode = 'PT429';
    end if;
    insert into public.rate_limits (key) values ('reg:' || ip);
  end if;

  -- uma inscrição por vez, para nunca passar do limite de vagas
  perform pg_advisory_xact_lock(727001);
  select * into s from public.settings where id = 1;
  if not s.open then
    raise exception 'As inscrições estão fechadas no momento.' using errcode = 'PT403';
  end if;

  parts := public.camp_validate_participants(payload->'participants', true);
  n := jsonb_array_length(parts);
  has_minor := exists (select 1 from jsonb_array_elements(parts) e where (e->>'idade')::int < 18);
  if has_minor then
    acc := case payload->>'accompanied' when 'sim' then 'sim' when 'nao' then 'nao' else '' end;
    if acc = '' then
      raise exception 'Informe se os menores de 18 anos vão com o responsável.' using errcode = 'PT400';
    end if;
    if acc = 'nao' then
      if coalesce(payload->>'authAck', '') <> 'true' then
        raise exception 'Confirme que levará a autorização assinada dos responsáveis.' using errcode = 'PT400';
      end if;
      auth := true;
    end if;
  end if;
  if coalesce(payload->>'payPlan', '') not in ('pix', 'cartao', 'crediario') then
    raise exception 'Escolha a forma de pagamento: Pix, cartão de crédito ou crediário.' using errcode = 'PT400';
  end if;
  if coalesce(payload->>'agree', '') <> 'true' or coalesce(payload->>'imgAck', '') <> 'true' then
    raise exception 'Aceite as duas confirmações para continuar.' using errcode = 'PT400';
  end if;

  taken := public.camp_taken();
  if n > greatest(0, s.capacity - taken) then
    if s.capacity - taken > 0 then
      raise exception 'Restam apenas % vagas.', s.capacity - taken using errcode = 'PT409';
    end if;
    raise exception 'As vagas se esgotaram.' using errcode = 'PT409';
  end if;

  proto := public.camp_new_protocol();
  insert into public.registrations (protocol, source, accompanied, auth_ack, consent_at, amount, pay_plan)
    values (proto, 'site', acc, auth, now(), round(n * s.price, 2), payload->>'payPlan')
    returning id into rid;
  insert into public.participants (registration_id, position, nome, idade, tel, igreja, obs)
    select rid, (ord - 1)::int, e->>'nome', (e->>'idade')::int, e->>'tel', e->>'igreja', e->>'obs'
    from jsonb_array_elements(parts) with ordinality as t(e, ord);

  return jsonb_build_object('ok', true, 'protocol', proto, 'amount', round(n * s.price, 2),
                            'remaining', greatest(0, s.capacity - taken - n));
end $$;

-- ---------------------------------------------------------------------
-- Funções do painel (exigem login de administrador)
-- ---------------------------------------------------------------------

-- Nova inscrição feita pelo organizador (WhatsApp / pessoalmente)
create or replace function public.camp_admin_create(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.settings%rowtype;
  v_force boolean := coalesce(payload->>'force', '') = 'true';
  parts jsonb;
  n int;
  has_minor boolean;
  taken int;
  rid uuid;
  proto text;
  pay jsonb := payload->'payment';
  v_plan text := case when payload->>'payPlan' in ('pix', 'cartao', 'crediario') then payload->>'payPlan' else '' end;
  amt numeric;
  meth text;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = 'PT403';
  end if;
  perform pg_advisory_xact_lock(727001);
  select * into s from public.settings where id = 1;
  parts := public.camp_validate_participants(payload->'participants', not v_force);
  n := jsonb_array_length(parts);
  taken := public.camp_taken();
  if not v_force and n > greatest(0, s.capacity - taken) then
    raise exception 'Passa do limite de vagas (restam %).', greatest(0, s.capacity - taken) using errcode = 'PT409';
  end if;
  has_minor := exists (select 1 from jsonb_array_elements(parts) e where (e->>'idade')::int < 18);
  proto := public.camp_new_protocol();
  insert into public.registrations (protocol, source, accompanied, consent_at, consent_by_admin, amount, admin_note, pay_plan)
    values (proto, 'admin',
            case when has_minor then (case payload->>'accompanied' when 'nao' then 'nao' else 'sim' end) else '' end,
            now(), true, round(n * s.price, 2), left(coalesce(payload->>'adminNote', ''), 2000), v_plan)
    returning id into rid;
  insert into public.participants (registration_id, position, nome, idade, tel, igreja, obs)
    select rid, (ord - 1)::int, e->>'nome', (e->>'idade')::int, e->>'tel', e->>'igreja', e->>'obs'
    from jsonb_array_elements(parts) with ordinality as t(e, ord);
  if pay is not null and jsonb_typeof(pay) = 'object' then
    amt := nullif(pay->>'amount', '')::numeric;
    if amt is not null and amt > 0 then
      meth := case when pay->>'method' in ('Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro') then pay->>'method' else 'Pix' end;
      insert into public.payments (registration_id, amount, method, paid_on, note)
        values (rid, round(amt, 2), meth, coalesce(nullif(pay->>'date', '')::date, current_date), left(coalesce(pay->>'note', ''), 200));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', rid, 'protocol', proto);
end $$;

-- Cancelar / reativar (reativar confere o limite de vagas)
create or replace function public.camp_admin_set_status(p_id uuid, p_status text, p_force boolean default false)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.settings%rowtype;
  taken int;
  n int;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = 'PT403';
  end if;
  if p_status not in ('ativa', 'cancelada') then
    raise exception 'Situação inválida.' using errcode = 'PT400';
  end if;
  perform pg_advisory_xact_lock(727001);
  if p_status = 'ativa' and not coalesce(p_force, false)
     and exists (select 1 from public.registrations where id = p_id and status = 'cancelada') then
    select * into s from public.settings where id = 1;
    taken := public.camp_taken();
    select count(*) into n from public.participants where registration_id = p_id;
    if n > greatest(0, s.capacity - taken) then
      raise exception 'Reativar passa do limite de vagas (restam %).', greatest(0, s.capacity - taken) using errcode = 'PT409';
    end if;
  end if;
  update public.registrations set status = p_status where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public.camp_taken()                                  from public, anon, authenticated;
revoke all on function public.camp_new_protocol()                           from public, anon, authenticated;
revoke all on function public.camp_validate_participants(jsonb, boolean)    from public, anon, authenticated;
revoke all on function public.touch_updated_at()                            from public, anon, authenticated;
revoke all on function public.enforce_payment_rules()                       from public, anon, authenticated;
revoke all on function public.enforce_plan_change()                         from public, anon, authenticated;
revoke all on function public.camp_status()                                 from public, anon, authenticated;
revoke all on function public.camp_register(jsonb)                          from public, anon, authenticated;
revoke all on function public.camp_admin_create(jsonb)                      from public, anon, authenticated;
revoke all on function public.camp_admin_set_status(uuid, text, boolean)    from public, anon, authenticated;
revoke all on function public.is_admin()                                    from public, anon, authenticated;

grant execute on function public.camp_status()                              to anon, authenticated;
grant execute on function public.camp_register(jsonb)                       to anon, authenticated;
grant execute on function public.camp_admin_create(jsonb)                   to authenticated;
grant execute on function public.camp_admin_set_status(uuid, text, boolean) to authenticated;
grant execute on function public.is_admin()                                 to authenticated;
