-- Mi Departamento · Migración 2: permisos, RLS, funciones y vista de saldos
create function private.is_household_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = (select auth.uid()))
$$;
create function private.is_household_owner(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = (select auth.uid()) and m.role = 'owner')
$$;
revoke all on function private.is_household_member(uuid), private.is_household_owner(uuid) from public, anon;
grant execute on function private.is_household_member(uuid), private.is_household_owner(uuid) to authenticated;

-- Vista de saldos: el estado se DERIVA de los pagos, nunca se guarda
create view public.bills_overview with (security_invoker = true) as
select b.*,
  coalesce(p.paid, 0)::numeric(14,2) as paid_amount,
  (b.amount - coalesce(p.paid, 0))::numeric(14,2) as balance,
  p.last_paid_on, p.last_method,
  case
    when coalesce(p.paid, 0) >= b.amount then 'pagado'
    when not b.confirmed then 'confirmar'
    when b.due_date < (now() at time zone 'America/Argentina/Cordoba')::date then 'vencido'
    else 'proximo'
  end as status
from public.bills b
left join lateral (
  select sum(pa.amount) as paid, max(pa.paid_on) as last_paid_on,
         (array_agg(pa.method order by pa.paid_on desc, pa.created_at desc))[1] as last_method
  from public.payments pa where pa.bill_id = b.id
) p on true;

-- Permisos de tabla (mínimos) + RLS
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
grant select on public.households, public.household_members, public.services, public.bills, public.payments, public.bill_attachments, public.products, public.bills_overview to authenticated;
grant update (name, address, address_confirmed) on public.households to authenticated;
grant select (id, household_id, email, created_at, expires_at, used_at) on public.household_invites to authenticated;
grant insert, update on public.services to authenticated;
grant insert, update, delete on public.bills to authenticated;
grant delete on public.payments to authenticated;
grant insert, delete on public.bill_attachments to authenticated;
grant insert, update, delete on public.products to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.services enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.bill_attachments enable row level security;
alter table public.products enable row level security;

create policy households_select on public.households for select to authenticated using (private.is_household_member(id));
create policy households_update on public.households for update to authenticated using (private.is_household_member(id)) with check (private.is_household_member(id));
create policy members_select on public.household_members for select to authenticated using (private.is_household_member(household_id));
create policy invites_select on public.household_invites for select to authenticated using (private.is_household_owner(household_id));

create policy services_select on public.services for select to authenticated using (private.is_household_member(household_id));
create policy services_insert on public.services for insert to authenticated with check (private.is_household_member(household_id));
create policy services_update on public.services for update to authenticated using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));

create policy bills_select on public.bills for select to authenticated using (private.is_household_member(household_id));
create policy bills_insert on public.bills for insert to authenticated with check (private.is_household_member(household_id));
create policy bills_update on public.bills for update to authenticated using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy bills_delete on public.bills for delete to authenticated using (private.is_household_member(household_id));

create policy payments_select on public.payments for select to authenticated using (private.is_household_member(household_id));
create policy payments_delete on public.payments for delete to authenticated using (private.is_household_member(household_id));

create policy attachments_select on public.bill_attachments for select to authenticated using (private.is_household_member(household_id));
create policy attachments_insert on public.bill_attachments for insert to authenticated with check (private.is_household_member(household_id));
create policy attachments_delete on public.bill_attachments for delete to authenticated using (private.is_household_member(household_id));

create policy products_select on public.products for select to authenticated using (private.is_household_member(household_id));
create policy products_insert on public.products for insert to authenticated with check (private.is_household_member(household_id));
create policy products_update on public.products for update to authenticated using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy products_delete on public.products for delete to authenticated using (private.is_household_member(household_id));

-- Funciones (RPC): operaciones que deben ser atómicas o que otorgan acceso
create function public.create_household(p_name text default 'Mi Departamento', p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'Necesitás iniciar sesión' using errcode = '28000'; end if;
  if exists (select 1 from public.household_members where user_id = v_uid) then raise exception 'Ya pertenecés a un hogar'; end if;
  insert into public.households(name, created_by) values (coalesce(nullif(btrim(p_name), ''), 'Mi Departamento'), v_uid) returning id into v_id;
  insert into public.household_members(household_id, user_id, role, display_name) values (v_id, v_uid, 'owner', nullif(btrim(p_display_name), ''));
  return v_id;
end $$;

create function public.create_household_invite(p_household uuid, p_email text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
begin
  if not private.is_household_owner(p_household) then raise exception 'Solo quien creó el hogar puede invitar' using errcode = '42501'; end if;
  update public.household_invites set expires_at = now() where household_id = p_household and used_at is null and expires_at > now();
  insert into public.household_invites(household_id, code_hash, email, created_by)
  values (p_household, encode(sha256(convert_to(v_code, 'utf8')), 'hex'), nullif(lower(btrim(p_email)), ''), (select auth.uid()));
  return v_code;
end $$;

create function public.join_household_with_code(p_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_inv public.household_invites%rowtype; v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  if v_uid is null then raise exception 'Necesitás iniciar sesión' using errcode = '28000'; end if;
  if exists (select 1 from public.household_members where user_id = v_uid) then raise exception 'Ya pertenecés a un hogar'; end if;
  select * into v_inv from public.household_invites
   where code_hash = encode(sha256(convert_to(upper(btrim(p_code)), 'utf8')), 'hex') and used_at is null and expires_at > now() for update;
  if not found or (v_inv.email is not null and v_inv.email <> v_email) then raise exception 'Código inválido o vencido' using errcode = '42501'; end if;
  if (select count(*) from public.household_members where household_id = v_inv.household_id) >= 5 then raise exception 'El hogar alcanzó el máximo de miembros'; end if;
  insert into public.household_members(household_id, user_id, role, display_name) values (v_inv.household_id, v_uid, 'member', nullif(btrim(p_display_name), ''));
  update public.household_invites set used_at = now(), used_by = v_uid where id = v_inv.id;
  return v_inv.household_id;
end $$;

create function public.register_payment(p_bill uuid, p_amount numeric, p_paid_on date, p_method text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hid uuid; v_id uuid;
begin
  select household_id into v_hid from public.bills where id = p_bill for update;
  if v_hid is null or not private.is_household_member(v_hid) then raise exception 'Factura no encontrada' using errcode = '42501'; end if;
  insert into public.payments(household_id, bill_id, amount, paid_on, method, notes)
  values (v_hid, p_bill, round(p_amount, 2), p_paid_on, p_method, nullif(btrim(p_notes), '')) returning id into v_id;
  update public.bills set confirmed = true where id = p_bill and not confirmed;
  return v_id;
end $$;

create function public.create_expense(p_household uuid, p_name text, p_category text, p_amount numeric, p_date date, p_method text default 'Efectivo', p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_household_member(p_household) then raise exception 'Sin acceso al hogar' using errcode = '42501'; end if;
  insert into public.bills(household_id, name, category, kind, amount, issue_date, due_date, period, confirmed, notes)
  values (p_household, btrim(p_name), p_category, 'gasto', round(p_amount, 2), p_date, p_date, date_trunc('month', p_date)::date, true, nullif(btrim(p_notes), ''))
  returning id into v_id;
  insert into public.payments(household_id, bill_id, amount, paid_on, method) values (p_household, v_id, round(p_amount, 2), p_date, p_method);
  return v_id;
end $$;

create function public.seed_starter_products(p_household uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.is_household_member(p_household) then raise exception 'Sin acceso al hogar' using errcode = '42501'; end if;
  insert into public.products(household_id, name, emoji, category, is_demo) values
   (p_household,'Pasta de dientes','🪥','Higiene personal',true),(p_household,'Shampoo','🧴','Higiene personal',true),(p_household,'Jabón de manos','🧼','Higiene personal',true),
   (p_household,'Papel higiénico','🧻','Baño',true),(p_household,'Detergente','🫧','Cocina',true),(p_household,'Esponjas','🧽','Cocina',true),
   (p_household,'Lavandina','🧪','Limpieza',true),(p_household,'Limpiador multiuso','🧹','Limpieza',true),(p_household,'Bolsas de residuos','🗑️','Limpieza',true),
   (p_household,'Café','☕','Alimentos',true),(p_household,'Leche','🥛','Alimentos',true),(p_household,'Arroz','🍚','Alimentos',true),(p_household,'Huevos','🥚','Alimentos',true)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.create_household(text, text), public.create_household_invite(uuid, text), public.join_household_with_code(text, text),
  public.register_payment(uuid, numeric, date, text, text), public.create_expense(uuid, text, text, numeric, date, text, text), public.seed_starter_products(uuid) from public, anon;
grant execute on function public.create_household(text, text), public.create_household_invite(uuid, text), public.join_household_with_code(text, text),
  public.register_payment(uuid, numeric, date, text, text), public.create_expense(uuid, text, text, numeric, date, text, text), public.seed_starter_products(uuid) to authenticated;
