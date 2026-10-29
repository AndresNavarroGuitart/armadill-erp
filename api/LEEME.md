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

## Lo que falta

- Adaptador de producción para `crearBd` con `pg` (hoy está el de PGlite) y la carga de `19_api.sql` en Supabase.
- Si el proyecto de Supabase firma con clave asimétrica (ES256), hay que sumar la verificación por JWKS.
- Anular y notas de crédito, compras, cobros y pagos, y la conexión con ARCA (CAE).
- Que el front React use esta API en lugar de los datos del prototipo.
