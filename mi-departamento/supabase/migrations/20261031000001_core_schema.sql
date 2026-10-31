-- Mi Departamento · Migración 1: esquema base (hogares, servicios, facturas, pagos, archivos, productos)
create schema if not exists private;
grant usage on schema private to authenticated;

create domain public.bill_category as text check (value in ('Alquiler','Electricidad','Gas','Agua','Internet','Impuestos','Expensas','Otros'));
create domain public.product_category as text check (value in ('Higiene personal','Baño','Cocina','Limpieza','Alimentos','Otros'));
create domain public.payment_method as text check (value in ('Transferencia','Débito automático','Tarjeta','Efectivo','Otro'));

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create function private.lock_household_id() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.household_id is distinct from old.household_id then raise exception 'El hogar de un registro no se puede modificar'; end if;
  return new;
end $$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mi Departamento' check (char_length(btrim(name)) between 1 and 60),
  address text check (address is null or char_length(address) <= 120),
  address_confirmed boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  display_name text check (display_name is null or char_length(display_name) <= 40),
  joined_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (user_id)  -- una cuenta pertenece a un único hogar
);
create index household_members_household_idx on public.household_members(household_id);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code_hash text not null unique,           -- se guarda solo el hash; el código se muestra una vez
  email text check (email is null or email = lower(email)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);
create index household_invites_household_idx on public.household_invites(household_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  company text check (company is null or char_length(company) <= 60),
  category public.bill_category not null default 'Otros',
  description text check (description is null or char_length(description) <= 200),
  archived_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index services_household_idx on public.services(household_id);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  service_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  company text check (company is null or char_length(company) <= 60),
  category public.bill_category not null default 'Otros',
  kind text not null default 'factura' check (kind in ('factura','gasto')),
  amount numeric(14,2) not null check (amount > 0),
  issue_date date,
  due_date date not null,
  period date not null check (extract(day from period) = 1),   -- primer día del mes al que corresponde
  confirmed boolean not null default true,                      -- false = pendiente de confirmar
  notes text check (notes is null or char_length(notes) <= 500),
  consumption_units numeric(12,3) check (consumption_units is null or consumption_units >= 0),
  consumption_unit text check (consumption_unit is null or char_length(consumption_unit) between 1 and 12),
  is_demo boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint bills_consumption_pair check ((consumption_units is null) = (consumption_unit is null)),
  constraint bills_service_fk foreign key (service_id, household_id) references public.services(id, household_id) on delete restrict
);
create index bills_household_period_idx on public.bills(household_id, period);
create index bills_household_due_idx on public.bills(household_id, due_date);
create index bills_service_idx on public.bills(service_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  method public.payment_method not null default 'Transferencia',
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payments_bill_fk foreign key (bill_id, household_id) references public.bills(id, household_id) on delete cascade
);
create index payments_bill_idx on public.payments(bill_id);
create index payments_household_paid_idx on public.payments(household_id, paid_on);

create table public.bill_attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_id uuid not null,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attachments_path_in_household check (storage_path like household_id::text || '/%'),
  constraint attachments_bill_fk foreign key (bill_id, household_id) references public.bills(id, household_id) on delete cascade
);
create index bill_attachments_bill_idx on public.bill_attachments(bill_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  category public.product_category not null default 'Otros',
  emoji text not null default '🛒' check (char_length(emoji) between 1 and 8),
  needs_purchase boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_household_name_uq on public.products(household_id, lower(btrim(name)));
create index products_household_pending_idx on public.products(household_id) where needs_purchase;

-- updated_at y bloqueo de household_id
create trigger households_touch before update on public.households for each row execute function private.touch_updated_at();
create trigger services_touch before update on public.services for each row execute function private.touch_updated_at();
create trigger bills_touch before update on public.bills for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger services_lock before update on public.services for each row execute function private.lock_household_id();
create trigger bills_lock before update on public.bills for each row execute function private.lock_household_id();
create trigger products_lock before update on public.products for each row execute function private.lock_household_id();

-- Consistencia de pagos: nunca se paga más que el importe de la factura
create function private.check_payment_total() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_amount numeric; v_paid numeric;
begin
  select amount into v_amount from public.bills where id = new.bill_id for update;
  select coalesce(sum(amount),0) into v_paid from public.payments where bill_id = new.bill_id and id is distinct from new.id;
  if v_paid + new.amount > v_amount then
    raise exception 'El pago supera el saldo pendiente de la factura' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payments_check before insert or update on public.payments for each row execute function private.check_payment_total();

create function private.check_bill_amount() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.amount < (select coalesce(sum(amount),0) from public.payments where bill_id = new.id) then
    raise exception 'El importe no puede ser menor a lo ya pagado' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger bills_amount_check before update of amount on public.bills for each row execute function private.check_bill_amount();

create function private.block_delete_paid_bill() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.payments where bill_id = old.id) then
    raise exception 'No se puede eliminar un registro con pagos. Eliminá primero los pagos.' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger bills_block_delete before delete on public.bills for each row execute function private.block_delete_paid_bill();
