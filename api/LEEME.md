# API de administraNET (primer tramo)

Backend real sobre el modelo de datos (`modelo/`): sesión y empresa activa, permisos por rol, clientes, proveedores, artículos con listas y precios, y **factura de venta sin ARCA** (comprobante, asiento automático, stock y trazabilidad en una sola transacción). Es un manejador Node `(req, res)` sin framework, para poder montarlo en Netlify Functions, un servidor propio o el de pruebas.

## Cómo se prueba

```
npm run test:api     # 33 pruebas contra la base real del modelo (PGlite) y un servidor HTTP en un puerto libre
npm run api:dev      # servidor de desarrollo con datos de ejemplo; imprime un token por persona
```

`api:dev` se niega a arrancar con `NODE_ENV=production`. Los datos viven en memoria.

## Cómo se identifica a la persona

1. El front obtiene un JWT del proveedor de identidad (Supabase Auth) y lo manda en `Authorization: Bearer`.
2. `auth.mjs` lo verifica: HS256 con el algoritmo fijado (no acepta `none` ni otro), firma en tiempo constante, `exp`, `nbf`, `aud`, `iss`.
3. Con el `sub` se busca a la persona en `usuario.auth_sub` (`fn_autenticar`). La primera vez se vincula por **email verificado** y una sola vez. Las personas dadas de baja no entran.
4. `X-Empresa-Id` elige la empresa activa; `fn_contexto_empresa` devuelve el rol y los permisos **solo** si la persona tiene vínculo con esa empresa. Una empresa ajena es 403.
5. Cada consulta corre con `set_config('app.estudio_id'|'app.empresa_id'|'app.usuario_id')` y el rol `app_usuario`: el aislamiento por empresa lo impone la base (RLS), no el código de la API.

Roles base (`fn_roles_base`): Administrador, Contador, Auxiliar, Consulta.

## Rutas

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/salud` | — | responde `{ok:true}` |
| `GET /api/yo` | sesión | persona, empresas y, con `X-Empresa-Id`, rol y permisos |
| `GET/POST /api/clientes`, `GET/PATCH /api/clientes/:id` | `clientes.ver` / `clientes.editar` | `q`, `activo`, `limite`, `desplazamiento`; trae el saldo |
| `GET/POST /api/proveedores`, `GET/PATCH /api/proveedores/:id` | `proveedores.ver` / `.editar` | igual; dar de alta como proveedor a un cliente existente le suma el rol |
| `GET/POST /api/articulos`, `GET/PATCH /api/articulos/:id`, `PUT /api/articulos/:id/precios` | `articulos.ver` / `.editar` | precio vigente por lista y fecha (`lista_id`, `fecha`) |
| `GET/POST /api/listas-precio` | `articulos.ver` / `.editar` | listas de precios |
| `POST /api/ventas/facturas/calcular` | `ventas.emitir` | cálculo previo; no guarda nada |
| `POST /api/ventas/facturas` | `ventas.emitir` | emite la factura; `Idempotency-Key` opcional |
| `GET /api/comprobantes`, `GET /api/comprobantes/:id` | `ventas.ver` | filtros `estado`, `tercero_id`, `desde`, `hasta` |

## Reglas que conviene recordar

- **El total nunca viene del cliente**: se calcula en el servidor con la misma aritmética exacta (decimales, sin punto flotante) que `reglas/calculo.mjs`; un campo desconocido en el cuerpo se rechaza.
- **Letra automática**: la elige la condición frente al IVA de la empresa y del cliente (A, B o C); en la C no se discrimina IVA. El cliente se guarda con su condición (RG 5616).
- **Todo o nada**: si falta stock, el período está cerrado o falla el asiento, no queda comprobante, ni número consumido, ni movimiento de stock.
- **Puntos de venta**: hoy solo `interno` y `preimpresa`. Uno electrónico (`ws_factura`) responde 409 `arca_pendiente` hasta conectar ARCA. Sin indicar `punto_venta`, se usa el único que se pueda usar.
- **Idempotencia**: misma clave y mismo pedido → 200 con el mismo comprobante (`repetido: true`); misma clave con otro pedido → 422.
- **Trazabilidad**: cada alta, cambio (con antes y después) y emisión queda en `evento`, en la misma transacción, con la persona y la empresa. Un cambio que no cambia nada no genera evento.
- **Errores**: `{ "error": { "codigo", "mensaje", "campos" } }`; los errores de validación traen todos los campos con problema juntos. Nunca se devuelven trazas ni mensajes internos de la base.
- **Aislamiento**: pedir un id de otra empresa o de otro estudio da 404 (no 403), para no confirmar que existe.
- **Navegador**: CORS solo para los orígenes permitidos; límite de pedidos (429 con `Retry-After`); tope de tamaño (413); `Cache-Control: no-store`.

## Puesta en producción (Supabase)

Piezas ya hechas y probadas contra una base PostgreSQL de verdad (PGlite por socket, con el mismo migrador y el mismo adaptador):

| Pieza | Qué hace |
|---|---|
| `modelo/migrar_pg.mjs` | Aplica el modelo a la base, un archivo por transacción, con constancia y huella en `schema_migracion`. Repetible; frena si un archivo ya aplicado fue modificado. Sin `--aplicar` solo muestra qué falta |
| `modelo/20_endurecimiento_supabase.sql` | Cierra el acceso de `anon` y `authenticated` (la API REST de Supabase no se usa) |
| `api/bd_pg.mjs` | Pool de `pg`; cada pedido es una transacción con límites de tiempo, contexto local y `SET LOCAL ROLE app_usuario` (seguro detrás del pooler en modo transacción) |
| `api/jwt.mjs` | Verifica ES256/RS256 con las claves públicas del proyecto (JWKS, con caché y sin recargas por `kid` inventadas) y, si se configura, HS256 |
| `api/servidor.mjs` + `api/configuracion.mjs` | Servidor de producción; no arranca si falta algo y lista todos los problemas juntos |

### Variables de entorno del servidor

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | sí | Conexión con el usuario **dueño** (`postgres`): necesita saltear la RLS solo para las funciones de identidad; el trabajo siempre baja a `app_usuario` |
| `SUPABASE_URL` | sí* | De acá salen el emisor (`…/auth/v1`) y las claves públicas (`…/.well-known/jwks.json`). *O `SUPABASE_JWT_SECRET` (secreto heredado, mín. 32 caracteres) |
| `ORIGENES` | sí | Direcciones del front, separadas por coma, solo origen y con https (http solo localhost). No admite `*` |
| `DATABASE_CA` | según el caso | Certificado PEM de la autoridad de la base si la conexión TLS no valida con las de Node (el de Supabase se descarga desde su panel). Con `
` escritos como texto sirve |
| `TRUST_PROXY_HOPS` | no (0) | Cuántos proxies propios hay delante; define qué IP queda en la trazabilidad. **Con 0 se ignora `X-Forwarded-For`** |
| `PORT`, `HOST`, `POOL_MAX`, `LIMITE_POR_MINUTO`, `JWT_AUDIENCIA` | no | 8080, 0.0.0.0, 10, 240 por persona, `authenticated` |

### Orden para la primera vez

1. **Supabase → Authentication:** desactivar el alta libre ("Allow new users to sign up"), exigir confirmación de email, fijar la lista de URLs de retorno (la del front) y usar claves de firma asimétricas (JWT Signing Keys). Subir el largo mínimo de contraseña a 12 y activar la protección de contraseñas filtradas.
2. **Supabase → API:** quitar `public` de los esquemas expuestos o desactivar la Data API (el sistema no la usa; `20_endurecimiento_supabase.sql` es la segunda barrera, no la única).
3. `DATABASE_URL=… npm run db:migrar` (muestra qué falta) y luego `DATABASE_URL=… npm run db:migrar -- --aplicar`. Usar la conexión **directa** (puerto 5432) para migrar.
4. Dar de alta el estudio, sus personas y empresas (hoy a mano o con un script; falta la pantalla de administración). Cada persona se crea en `usuario` con su email; en Supabase se la **invita** con ese mismo email: el primer ingreso se vincula por email verificado.
5. Levantar `npm run api:servidor` con las variables de arriba (para la base conviene la conexión del pooler en modo transacción, puerto 6543).
6. Front: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (ver `app/.env.example`).

### Qué no se pudo probar acá
Todo esto se verificó contra PGlite y un proveedor de identidad simulado, **no contra un proyecto real de Supabase**: no hay credenciales en esta máquina. Quedan por confirmar en el primer despliegue: que `btree_gist` se cree bien en su esquema de extensiones, que el pooler en modo transacción acepte el patrón (debería: todo es `SET LOCAL`), que el certificado TLS valide y que los correos de invitación y recuperación lleguen con las URLs de retorno correctas.

## Lo que falta

- Probarlo contra un proyecto real de Supabase (ver arriba) y decidir dónde corre el servidor (hoy es un proceso Node: sirve en cualquier hosting de contenedores o de Node).
- Doble factor de autenticación (MFA) y registro de intentos fallidos de ingreso en la trazabilidad.
- Anular y notas de crédito, compras, cobros y pagos, y la conexión con ARCA (CAE).
- El front real (`app/`, React) ya usa esta API para ingreso, clientes, proveedores, artículos y factura de venta; ver [app/LEEME.md](../app/LEEME.md).
