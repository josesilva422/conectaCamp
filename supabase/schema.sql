-- =====================================================================
-- CONECTAcamp — banco de dados (Supabase / Postgres)
--
-- COMO USAR:
--   1) Abra o projeto > SQL Editor > New query
--   2) Cole este arquivo inteiro e clique em Run
--   3) Authentication > Users > Add user: crie o usuário do organizador
--      (e-mail abaixo, com senha; marque "Auto confirm user")
--   4) Authentication > Sign In / Providers: desative "Allow new users to sign up"
--
-- É seguro rodar de novo: usa "if not exists" e "create or replace".
-- Inclui: inscrições, pagamentos, CPF, voucher por pessoa, consulta pública do
-- voucher, entrada pelo celular e validação da entrada pelo painel.
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
-- Entrada pelo celular (destacar o voucher): ligue só no dia do acampamento
alter table public.settings
  add column if not exists self_checkin boolean not null default false;
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

-- CPF (só dígitos; vazio = não informado), código do voucher e entrada no acampamento
alter table public.participants add column if not exists cpf text not null default '' check (cpf = '' or cpf ~ '^[0-9]{11}$');
alter table public.participants add column if not exists voucher text;
alter table public.participants add column if not exists checkin_at timestamptz;
alter table public.participants add column if not exists checkin_unpaid boolean not null default false;  -- entrou sem pagamento total (liberado pelo painel)
alter table public.participants add column if not exists checkin_self boolean not null default false;    -- entrada feita pelo celular da própria pessoa

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

-- ---------------------------------------------------------------------
-- Regras de pagamento (valem para qualquer caminho que grave pagamentos)
-- ---------------------------------------------------------------------
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
      raise exception '% é pago de uma vez só: R$ %.', nome, replace(to_char(r.amount, 'FM999990.00'), '.', ',') using errcode = 'PT400';
    end if;
  elsif paid + new.amount > r.amount then
    raise exception 'O pagamento passa do valor da inscrição (falta R$ %).', replace(to_char(greatest(0, r.amount - paid), 'FM999990.00'), '.', ',') using errcode = 'PT400';
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
-- CPF e voucher
-- ---------------------------------------------------------------------
-- CPF válido pelos dígitos verificadores (só números, 11 dígitos)
create or replace function public.camp_valid_cpf(c text)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare s int; i int; t int;
begin
  if c is null or c !~ '^[0-9]{11}$' or c ~ '^(.)\1{10}$' then return false; end if;
  for t in 9..10 loop
    s := 0;
    for i in 1..t loop s := s + substr(c, i, 1)::int * (t + 2 - i); end loop;
    if ((s * 10) % 11) % 10 <> substr(c, t + 1, 1)::int then return false; end if;
  end loop;
  return true;
end $$;

-- Código do voucher: CCV-XXXX-XXXX (sem letras/números parecidos), único
create or replace function public.camp_new_voucher()
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  s text; i int; code text;
begin
  loop
    s := '';
    for i in 1..8 loop s := s || substr(alphabet, 1 + floor(random() * 32)::int, 1); end loop;
    code := 'CCV-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
    exit when not exists (select 1 from public.participants where voucher = code);
  end loop;
  return code;
end $$;

create or replace function public.participants_before_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (new.voucher is null or new.voucher = '') then
    new.voucher := public.camp_new_voucher();
  end if;
  new.cpf := regexp_replace(coalesce(new.cpf, ''), '[^0-9]', '', 'g');
  if new.cpf <> '' and (tg_op = 'INSERT' or new.cpf is distinct from old.cpf) then
    if not public.camp_valid_cpf(new.cpf) then
      raise exception 'CPF inválido para %.', new.nome using errcode = 'PT400';
    end if;
    -- um CPF só pode ter uma inscrição ativa (e não repete dentro da mesma inscrição)
    if exists (
      select 1 from public.participants p
      join public.registrations r on r.id = p.registration_id
      where p.cpf = new.cpf and p.id <> new.id
        and (p.registration_id = new.registration_id or r.status = 'ativa')
    ) then
      raise exception 'Já existe uma inscrição com o CPF de %. Use “Minha inscrição” no site para ver o voucher.', new.nome using errcode = 'PT409';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists participants_write on public.participants;
create trigger participants_write before insert or update of cpf on public.participants
  for each row execute function public.participants_before_write();

-- cadastros que já existiam ganham código de voucher
update public.participants set voucher = public.camp_new_voucher() where voucher is null or voucher = '';
alter table public.participants alter column voucher set not null;
create unique index if not exists participants_voucher_key on public.participants (voucher);
create index if not exists participants_cpf_idx on public.participants (cpf) where cpf <> '';

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

-- IP de quem chamou (cabeçalho que o Supabase repassa) para limitar tentativas
create or replace function public.camp_client_ip()
returns text language plpgsql stable security definer set search_path = ''
as $$
declare hdr json;
begin
  begin
    hdr := current_setting('request.headers', true)::json;
  exception when others then
    hdr := null;
  end;
  return coalesce(btrim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), '');
end $$;

drop function if exists public.camp_validate_participants(jsonb, boolean);
create or replace function public.camp_validate_participants(p_list jsonb, p_enforce_age boolean, p_require_cpf boolean)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.settings%rowtype;
  item jsonb;
  result jsonb := '[]'::jsonb;
  seen text[] := '{}';
  v_nome text; v_idade int; v_tel text; v_igreja text; v_obs text; v_cpf text;
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
    v_cpf    := regexp_replace(coalesce(item->>'cpf', ''), '[^0-9]', '', 'g');
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
    if (v_cpf <> '' or p_require_cpf) and not public.camp_valid_cpf(v_cpf) then
      raise exception '% para %.', case when v_cpf = '' then 'Informe o CPF' else 'CPF inválido' end, v_nome using errcode = 'PT400';
    end if;
    if v_cpf <> '' then
      if v_cpf = any (seen) then
        raise exception 'O mesmo CPF foi informado para mais de um participante.' using errcode = 'PT400';
      end if;
      seen := seen || v_cpf;
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'nome', v_nome, 'idade', v_idade, 'tel', v_tel, 'igreja', v_igreja, 'obs', v_obs, 'cpf', v_cpf));
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Funções públicas (o site chama estas, sem login)
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
  ip text;
  recent int;
begin
  -- campo-isca anti-robô: finge sucesso e não grava nada
  if coalesce(btrim(payload->>'hp'), '') <> '' then
    return jsonb_build_object('ok', true, 'protocol', 'CC-000000');
  end if;

  -- limite de inscrições por IP (8 por hora)
  ip := public.camp_client_ip();
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

  parts := public.camp_validate_participants(payload->'participants', true, true);
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
  -- o CPF é conferido (e o código do voucher criado) pelo gatilho participants_write
  insert into public.participants (registration_id, position, nome, idade, tel, igreja, obs, cpf)
    select rid, (ord - 1)::int, e->>'nome', (e->>'idade')::int, e->>'tel', e->>'igreja', e->>'obs', e->>'cpf'
    from jsonb_array_elements(parts) with ordinality as t(e, ord);

  return jsonb_build_object('ok', true, 'protocol', proto, 'amount', round(n * s.price, 2),
                            'remaining', greatest(0, s.capacity - taken - n));
end $$;

-- Consulta do voucher por CPF, protocolo ou código do voucher.
-- Devolve só o que o público pode ver (nunca telefone, alergias nem o CPF inteiro).
-- Não achou: devolve {"found": false} (e não erro) para a tentativa ficar registrada.
create or replace function public.camp_voucher_lookup(q text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  raw text := left(btrim(coalesce(q, '')), 60);
  dig text := regexp_replace(left(btrim(coalesce(q, '')), 60), '[^0-9]', '', 'g');
  k   text := upper(regexp_replace(left(btrim(coalesce(q, '')), 60), '[^A-Za-z0-9]', '', 'g'));
  ip text;
  rid uuid;
  only_pid uuid;
  r public.registrations%rowtype;
  s public.settings%rowtype;
  paid numeric;
  st text;
  vouchers jsonb;
begin
  ip := public.camp_client_ip();
  if ip <> '' then
    delete from public.rate_limits where at < now() - interval '1 day';
    if (select count(*) from public.rate_limits where key = 'vm:' || ip and at > now() - interval '10 minutes') >= 6
       or (select count(*) from public.rate_limits where key = 'vq:' || ip and at > now() - interval '10 minutes') >= 200 then
      raise exception 'Muitas tentativas. Aguarde um pouco e tente de novo.' using errcode = 'PT429';
    end if;
    insert into public.rate_limits (key) values ('vq:' || ip);
  end if;

  if raw ~ '^[-0-9. ]+$' and length(dig) = 11 then
    select p.registration_id, p.id into rid, only_pid
      from public.participants p join public.registrations x on x.id = p.registration_id
      where p.cpf = dig
      order by (x.status = 'ativa') desc, x.created_at desc limit 1;
  elsif length(k) = 11 and k like 'CCV%' then
    select p.registration_id, p.id into rid, only_pid from public.participants p where replace(p.voucher, '-', '') = k limit 1;
  elsif length(k) = 8 and k like 'CC%' then
    select x.id into rid from public.registrations x where replace(x.protocol, '-', '') = k limit 1;
  end if;

  if rid is null then
    if ip <> '' then insert into public.rate_limits (key) values ('vm:' || ip); end if;
    return jsonb_build_object('found', false);
  end if;

  select * into r from public.registrations where id = rid;
  select * into s from public.settings where id = 1;
  select coalesce(sum(amount), 0) into paid from public.payments where registration_id = rid;
  st := case when r.status = 'cancelada' then 'cancelada'
             when r.amount > 0 and paid >= r.amount then 'confirmado'
             when paid > 0 then 'parcial'
             else 'pre' end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', p.voucher, 'nome', p.nome, 'idade', p.idade, 'igreja', p.igreja,
           'cpf', case when length(p.cpf) = 11 then '***.' || substr(p.cpf, 4, 3) || '.' || substr(p.cpf, 7, 3) || '-**' else '' end,
           'minor', p.idade < 18,
           'auth', case when p.idade < 18 and r.accompanied = 'nao' then (case when r.auth_received then 'recebida' else 'pendente' end) else '' end,
           'checkin', case when p.checkin_at is not null then jsonb_build_object('at', p.checkin_at) else null end)
         order by p.position), '[]'::jsonb)
    into vouchers
    from public.participants p
    where p.registration_id = rid and (only_pid is null or p.id = only_pid);

  return jsonb_build_object('found', true, 'registration', jsonb_build_object('status', st),
                            'selfCheckin', s.self_checkin, 'vouchers', vouchers);
end $$;

-- Entrada pelo celular: a pessoa destaca o próprio voucher.
-- Só funciona com a chave ligada em Configurações, com inscrição ativa e paga por inteiro.
create or replace function public.camp_voucher_checkin(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  k text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  ip text;
  p public.participants%rowtype;
  r public.registrations%rowtype;
  s public.settings%rowtype;
  paid numeric;
begin
  ip := public.camp_client_ip();
  if ip <> '' then
    delete from public.rate_limits where at < now() - interval '1 day';
    if (select count(*) from public.rate_limits where key = 'cm:' || ip and at > now() - interval '10 minutes') >= 6
       or (select count(*) from public.rate_limits where key = 'cq:' || ip and at > now() - interval '10 minutes') >= 300 then
      raise exception 'Muitas tentativas. Aguarde um pouco e tente de novo.' using errcode = 'PT429';
    end if;
    insert into public.rate_limits (key) values ('cq:' || ip);
  end if;

  if length(k) = 11 and k like 'CCV%' then
    select * into p from public.participants where replace(voucher, '-', '') = k for update;
  end if;
  if p.id is null then
    if ip <> '' then insert into public.rate_limits (key) values ('cm:' || ip); end if;
    return jsonb_build_object('found', false);
  end if;

  if p.checkin_at is not null then
    return jsonb_build_object('ok', true, 'at', p.checkin_at, 'already', true);
  end if;
  select * into s from public.settings where id = 1;
  if not s.self_checkin then
    raise exception 'A entrada pelo celular ainda não foi liberada. Procure a organização na chegada.' using errcode = 'PT403';
  end if;
  select * into r from public.registrations where id = p.registration_id;
  if r.status <> 'ativa' then
    raise exception 'Inscrição cancelada: procure a organização.' using errcode = 'PT409';
  end if;
  select coalesce(sum(amount), 0) into paid from public.payments where registration_id = r.id;
  if not (r.amount > 0 and paid >= r.amount) then
    raise exception 'Pagamento ainda não confirmado. Procure a organização na chegada.' using errcode = 'PT409';
  end if;
  update public.participants set checkin_at = now(), checkin_unpaid = false, checkin_self = true
    where id = p.id returning checkin_at into p.checkin_at;
  return jsonb_build_object('ok', true, 'at', p.checkin_at);
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
  parts := public.camp_validate_participants(payload->'participants', not v_force, false);
  n := jsonb_array_length(parts);
  taken := public.camp_taken();
  if not v_force and n > greatest(0, s.capacity - taken) then
    raise exception 'Passa do limite de vagas (restam %).', greatest(0, s.capacity - taken)
      using errcode = 'PT409', detail = '{"canForce":true}';
  end if;
  has_minor := exists (select 1 from jsonb_array_elements(parts) e where (e->>'idade')::int < 18);
  proto := public.camp_new_protocol();
  insert into public.registrations (protocol, source, accompanied, consent_at, consent_by_admin, amount, admin_note, pay_plan)
    values (proto, 'admin',
            case when has_minor then (case payload->>'accompanied' when 'nao' then 'nao' else 'sim' end) else '' end,
            now(), true, round(n * s.price, 2), left(coalesce(payload->>'adminNote', ''), 2000), v_plan)
    returning id into rid;
  insert into public.participants (registration_id, position, nome, idade, tel, igreja, obs, cpf)
    select rid, (ord - 1)::int, e->>'nome', (e->>'idade')::int, e->>'tel', e->>'igreja', e->>'obs', e->>'cpf'
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

-- Cancelar / reativar (reativar confere o limite de vagas e se o CPF já foi usado em outra inscrição)
create or replace function public.camp_admin_set_status(p_id uuid, p_status text, p_force boolean default false)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.settings%rowtype;
  taken int;
  n int;
  clash text;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = 'PT403';
  end if;
  if p_status not in ('ativa', 'cancelada') then
    raise exception 'Situação inválida.' using errcode = 'PT400';
  end if;
  perform pg_advisory_xact_lock(727001);
  if p_status = 'ativa' and exists (select 1 from public.registrations where id = p_id and status = 'cancelada') then
    select p.nome into clash
      from public.participants p
      where p.registration_id = p_id and p.cpf <> ''
        and exists (select 1 from public.participants o join public.registrations r on r.id = o.registration_id
                    where o.cpf = p.cpf and r.status = 'ativa' and r.id <> p_id)
      limit 1;
    if clash is not null then
      raise exception 'Já existe uma inscrição com o CPF de %. Use “Minha inscrição” no site para ver o voucher.', clash using errcode = 'PT409';
    end if;
    if not coalesce(p_force, false) then
      select * into s from public.settings where id = 1;
      taken := public.camp_taken();
      select count(*) into n from public.participants where registration_id = p_id;
      if n > greatest(0, s.capacity - taken) then
        raise exception 'Reativar passa do limite de vagas (restam %).', greatest(0, s.capacity - taken)
          using errcode = 'PT409', detail = '{"canForce":true}';
      end if;
    end if;
  end if;
  update public.registrations set status = p_status where id = p_id;
end $$;

-- Registrar (ou desfazer) a entrada de uma pessoa pelo painel
create or replace function public.camp_admin_checkin(p_id uuid, p_undo boolean default false, p_force boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  p public.participants%rowtype;
  r public.registrations%rowtype;
  paid numeric;
  is_paid boolean;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = 'PT403';
  end if;
  select * into p from public.participants where id = p_id for update;
  if p.id is null then
    raise exception 'Participante não encontrado.' using errcode = 'PT404';
  end if;
  if coalesce(p_undo, false) then
    update public.participants set checkin_at = null, checkin_unpaid = false, checkin_self = false where id = p.id;
    return jsonb_build_object('ok', true);
  end if;
  select * into r from public.registrations where id = p.registration_id;
  if r.status <> 'ativa' then
    raise exception 'Inscrição cancelada: entrada não liberada.' using errcode = 'PT409';
  end if;
  if p.checkin_at is not null then
    raise exception 'A entrada de % já foi registrada.', p.nome using errcode = 'PT409',
      detail = jsonb_build_object('already', true, 'at', p.checkin_at)::text;
  end if;
  select coalesce(sum(amount), 0) into paid from public.payments where registration_id = r.id;
  is_paid := r.amount > 0 and paid >= r.amount;
  if not is_paid and not coalesce(p_force, false) then
    raise exception 'Pagamento ainda não confirmado (R$ % de R$ %).',
      replace(to_char(paid, 'FM999990.00'), '.', ','), replace(to_char(r.amount, 'FM999990.00'), '.', ',')
      using errcode = 'PT409', detail = '{"canForce":true}';
  end if;
  update public.participants set checkin_at = now(), checkin_unpaid = not is_paid, checkin_self = false
    where id = p.id returning checkin_at into p.checkin_at;
  return jsonb_build_object('ok', true, 'at', p.checkin_at);
end $$;

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public.camp_valid_cpf(text)                          from public, anon, authenticated;
revoke all on function public.camp_new_voucher()                            from public, anon, authenticated;
revoke all on function public.participants_before_write()                   from public, anon, authenticated;
revoke all on function public.camp_client_ip()                              from public, anon, authenticated;
revoke all on function public.camp_taken()                                  from public, anon, authenticated;
revoke all on function public.camp_new_protocol()                           from public, anon, authenticated;
revoke all on function public.camp_validate_participants(jsonb, boolean, boolean) from public, anon, authenticated;
revoke all on function public.touch_updated_at()                            from public, anon, authenticated;
revoke all on function public.enforce_payment_rules()                       from public, anon, authenticated;
revoke all on function public.enforce_plan_change()                         from public, anon, authenticated;
revoke all on function public.camp_status()                                 from public, anon, authenticated;
revoke all on function public.camp_register(jsonb)                          from public, anon, authenticated;
revoke all on function public.camp_voucher_lookup(text)                     from public, anon, authenticated;
revoke all on function public.camp_voucher_checkin(text)                    from public, anon, authenticated;
revoke all on function public.camp_admin_create(jsonb)                      from public, anon, authenticated;
revoke all on function public.camp_admin_set_status(uuid, text, boolean)    from public, anon, authenticated;
revoke all on function public.camp_admin_checkin(uuid, boolean, boolean)    from public, anon, authenticated;
revoke all on function public.is_admin()                                    from public, anon, authenticated;

grant execute on function public.camp_status()                              to anon, authenticated;
grant execute on function public.camp_register(jsonb)                       to anon, authenticated;
grant execute on function public.camp_voucher_lookup(text)                  to anon, authenticated;
grant execute on function public.camp_voucher_checkin(text)                 to anon, authenticated;
grant execute on function public.camp_admin_create(jsonb)                   to authenticated;
grant execute on function public.camp_admin_set_status(uuid, text, boolean) to authenticated;
grant execute on function public.camp_admin_checkin(uuid, boolean, boolean) to authenticated;
grant execute on function public.is_admin()                                 to authenticated;
