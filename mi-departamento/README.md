# Mi Departamento · Fase 2 (Supabase)

App web mobile-first para gestionar el departamento compartido: servicios, facturas, pagos (parciales o completos),
comprobantes privados, productos del hogar y lista del súper. Frontend en HTML/CSS/JS con Vite; datos, autenticación y
archivos en Supabase.

## Estructura
- `index.html` — marcado y estilos originales (diseño intacto) + pantalla de acceso.
- `src/app.js` — interfaz (vistas, modales, acciones). No habla con Supabase: usa `Store`.
- `src/store.js` — lógica de negocio y caché; orquesta los servicios y revierte si algo falla.
- `src/services/*.js` — acceso a datos (auth, hogares, servicios, facturas/pagos/archivos, productos).
- `src/lib/` — cliente Supabase y traducción de errores. `src/gate.js` — login, recuperación, alta/unión a un hogar.
- `supabase/migrations/` — esquema, RLS, funciones y Storage (reproducibles y auditables). `supabase/tests/` — verificación.

## Ejecutar localmente
```bash
cd mi-departamento
cp .env.example .env.local      # completá URL y clave publishable (Supabase → Project Settings → API)
npm install
npm run dev                     # abre http://localhost:5173
```
Para verificar la conexión: iniciá sesión; si carga el hogar, la app está leyendo de Supabase (Table Editor muestra los mismos datos).

## Primer uso: cuentas de Mateo y Salma
1. En Supabase → Authentication → URL Configuration, poné la **Site URL** (tu URL de despliegue o `http://localhost:5173`) y agregala a *Redirect URLs*. Sin esto no funcionan los enlaces de confirmación ni de recuperación.
2. Mateo abre la app → **Crear una cuenta** (su correo real) → confirma el correo → inicia sesión → **Crear el hogar**.
3. Ajustes → **Invitar a otra persona** → copiar el código (un solo uso, vence en 7 días; opcionalmente atado a un correo).
4. Salma crea su cuenta, confirma el correo e ingresa el código en **Unirme con un código**.
5. Recomendado cuando ambos estén dentro: Authentication → Providers → Email → desactivar *Allow new users to sign up*, para que nadie más pueda crear cuentas.
6. Recomendado: configurar un SMTP propio (el de Supabase por defecto tiene un límite bajo de correos por hora).

## Seguridad
- Solo se usa la clave pública en el navegador; **nunca** pongas `service_role` en el frontend.
- Todas las tablas tienen RLS: se accede solo a los datos del hogar del que sos miembro (`private.is_household_member`).
- Estado de facturas derivado de los pagos (vista `bills_overview`); los pagos se crean únicamente con `register_payment`/`create_expense` (atómicos, con bloqueo de fila y control de sobrepago).
- Comprobantes: bucket privado `bill-files`, 10 MB, PDF/JPG/PNG/WEBP, ruta `<hogar>/<factura>/<archivo>`, lectura por URL firmada de 5 minutos.

## Datos de demostración
La app **no** carga facturas ficticias. Los únicos datos de ejemplo son el catálogo inicial de productos (botón en *Mi hogar* cuando está vacío), marcados `is_demo`. La dirección «Obispo Oro 321» no se guarda hasta que la confirmes en Ajustes. Los datos viejos de `localStorage` (`md:*`) no se tocan ni se importan.

## Pruebas
`supabase/tests/rls_verification.sql` (pegar en el SQL Editor): crea usuarios de prueba, ejercita RLS, pagos parciales/completos, sobrepago, lista del súper y Storage, y se revierte siempre. Prueba manual con dos dispositivos: iniciar sesión con ambas cuentas y comprobar que ven lo mismo.

## Despliegue
`npm run build` genera `dist/`. Subilo a Vercel, Netlify o Cloudflare Pages definiendo `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` como variables de entorno, y actualizá la Site URL en Supabase.

## Pendiente / extensiones futuras
- **Lectura automática de facturas (OCR/IA):** no está activada. La tabla `bill_extractions` ya existe; el plan es una Edge Function con la clave del proveedor guardada como secreto de Supabase (nunca en el navegador) que lea el archivo desde Storage y escriba el resultado ahí. Requiere elegir proveedor, definir costo por factura y configurar la clave.
- **Notificaciones de vencimientos:** no implementadas. Requieren una tarea programada (pg_cron + Edge Function) y un canal (email/push). Los datos necesarios (`due_date`, `bills_overview.status`) ya están.
- Edición de una factura ya cargada y borrado individual de pagos desde la interfaz (los servicios `Bills.update` y `Bills.deletePayment` ya existen).

- Deploy inicial
