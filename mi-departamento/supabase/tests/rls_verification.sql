-- Verificación de seguridad y consistencia (RLS, pagos, Storage). Se ejecuta en una transacción que SIEMPRE se revierte:
-- no deja datos. Pegalo en Supabase → SQL Editor. El resultado aparece como "error" RESULTADOS con cada prueba (T1…T19).
-- Esperado: ninguna línea dice FALLO; T2/T2b/T2c/T16 = 0; T7 saldo=60000 estado=proximo; T9 estado=pagado; T11 total=115000.50.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  hid uuid; code text; svc uuid; bill uuid; prod uuid; n int; r text := ''; v record; path text;
begin
  insert into auth.users(id, email, aud, role) values (a,'a@test.local','authenticated','authenticated'),(b,'b@test.local','authenticated','authenticated'),(c,'c@test.local','authenticated','authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated','email','a@test.local')::text, true); execute 'set local role authenticated';
  hid := public.create_household('Mi Departamento','Mateo');
  insert into public.services(household_id,name,company,category) values (hid,'Electricidad','EPEC','Electricidad') returning id into svc;
  insert into public.bills(household_id,service_id,name,company,category,amount,due_date,period,consumption_units,consumption_unit)
    values (hid,svc,'Electricidad','EPEC','Electricidad',100000,current_date+5,date_trunc('month',current_date)::date,320,'kWh') returning id into bill;
  code := public.create_household_invite(hid, null); r := r || E'\nT1 A crea hogar/servicio/factura: OK';
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated','email','c@test.local')::text, true);
  select count(*) into n from public.bills; r := r || E'\nT2 C ve facturas: '||n||' (esperado 0)';
  select count(*) into n from public.bills_overview; r := r || E'\nT2b C ve vista: '||n||' (esperado 0)';
  select count(*) into n from public.households; r := r || E'\nT2c C ve hogares: '||n||' (esperado 0)';
  begin insert into public.bills(household_id,name,amount,due_date,period) values (hid,'x',1,current_date,date_trunc('month',current_date)::date); r := r || E'\nT3 FALLO'; exception when others then r := r || E'\nT3 C no inserta en hogar ajeno: OK'; end;
  begin perform public.register_payment(bill,10,current_date,'Efectivo'); r := r || E'\nT4 FALLO'; exception when others then r := r || E'\nT4 C no paga factura ajena: OK'; end;
  begin perform public.join_household_with_code('CODIGOFALSO1'); r := r || E'\nT5 FALLO'; exception when others then r := r || E'\nT5 código falso rechazado: OK'; end;
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated','email','b@test.local')::text, true);
  perform public.join_household_with_code(code,'Salma');
  select count(*) into n from public.services; r := r || E'\nT6 B ve servicios compartidos: '||n||' (esperado 1)';
  begin perform public.join_household_with_code(code); r := r || E'\nT6b FALLO'; exception when others then r := r || E'\nT6b código usado no se reutiliza: OK'; end;
  perform public.register_payment(bill,40000,current_date,'Transferencia');
  select * into v from public.bills_overview where id = bill; r := r || E'\nT7 pago parcial: pagado='||v.paid_amount||' saldo='||v.balance||' estado='||v.status;
  begin perform public.register_payment(bill,70000,current_date,'Transferencia'); r := r || E'\nT8 FALLO sobrepago'; exception when others then r := r || E'\nT8 sobrepago rechazado: OK'; end;
  begin insert into public.payments(household_id,bill_id,amount,paid_on) values (hid,bill,10,current_date); r := r || E'\nT8b FALLO'; exception when others then r := r || E'\nT8b insert directo en payments bloqueado: OK'; end;
  perform public.register_payment(bill,60000,current_date,'Transferencia');
  select * into v from public.bills_overview where id = bill; r := r || E'\nT9 pago completo: saldo='||v.balance||' estado='||v.status;
  begin delete from public.bills where id = bill; r := r || E'\nT10 FALLO'; exception when others then r := r || E'\nT10 no se borra factura con pagos: OK'; end;
  perform public.create_expense(hid,'Canilla','Otros',15000.50,current_date,'Efectivo');
  select sum(amount) as t, sum(paid_amount) as p into v from public.bills_overview where period = date_trunc('month',current_date)::date;
  r := r || E'\nT11 totales del mes: total='||v.t||' pagado='||v.p;
  insert into public.products(household_id,name,emoji,category) values (hid,'Café','☕','Alimentos') returning id into prod;
  update public.products set needs_purchase = true where id = prod;
  select count(*) into n from public.products where needs_purchase; r := r || E'\nT12 lista del súper: '||n||' (esperado 1)';
  update public.products set needs_purchase = false where id = prod;
  select count(*) into n from public.products where needs_purchase; r := r || E'\nT13 desmarcado: '||n||' en lista; producto existe='||exists(select 1 from public.products where id=prod);
  path := hid::text||'/'||bill||'/test.pdf';
  insert into storage.objects(bucket_id,name,owner,metadata) values ('bill-files',path,b,'{"mimetype":"application/pdf"}'); r := r || E'\nT15 B sube comprobante a su hogar: OK';
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated','email','c@test.local')::text, true);
  select count(*) into n from storage.objects where bucket_id='bill-files'; r := r || E'\nT16 C ve archivos: '||n||' (esperado 0)';
  begin insert into storage.objects(bucket_id,name,owner) values ('bill-files',hid::text||'/'||bill||'/evil.pdf',c); r := r || E'\nT17 FALLO'; exception when others then r := r || E'\nT17 C no sube a hogar ajeno: OK'; end;
  execute 'reset role'; execute 'set local role anon';
  begin perform count(*) from public.bills; r := r || E'\nT19 FALLO'; exception when others then r := r || E'\nT19 anon sin acceso a bills: OK'; end;
  execute 'reset role';
  raise exception E'RESULTADOS%', r;  -- fuerza el rollback: no queda ningún dato de prueba
end $$;
