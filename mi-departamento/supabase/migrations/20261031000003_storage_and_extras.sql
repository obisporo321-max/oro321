-- Mi Departamento · Migración 3: Storage privado para comprobantes y tabla preparada para OCR/IA
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bill-files', 'bill-files', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Ruta obligatoria: <household_id>/<bill_id>/<archivo>
create function private.storage_household(p_name text) returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end
$$;
grant execute on function private.storage_household(text) to authenticated;

create policy bill_files_select on storage.objects for select to authenticated
  using (bucket_id = 'bill-files' and private.is_household_member(private.storage_household(name)));
create policy bill_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bill-files' and private.is_household_member(private.storage_household(name)));
create policy bill_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bill-files' and private.is_household_member(private.storage_household(name)));

-- Arquitectura lista para extracción automática (aún sin proveedor configurado: nadie escribe aquí desde el cliente)
create table public.bill_extractions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  attachment_id uuid not null references public.bill_attachments(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  provider text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index bill_extractions_household_idx on public.bill_extractions(household_id);
alter table public.bill_extractions enable row level security;
revoke all on public.bill_extractions from anon, authenticated;
grant select on public.bill_extractions to authenticated;
create policy extractions_select on public.bill_extractions for select to authenticated using (private.is_household_member(household_id));
