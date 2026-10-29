# Front real de administraNET (primer tramo)

React + TypeScript + Vite sobre la API de `../api` (ver [api/LEEME.md](../api/LEEME.md)). Es independiente del prototipo de `../front` (que sigue siendo la referencia visual y de flujos): comparte el sistema de diseño (tokens en `src/estilos.css`) pero ya no usa datos de ejemplo en el navegador.

## Pantallas

| Pantalla | Qué hace |
|---|---|
| Ingreso | Con Supabase configurado: email y contraseña, enlace por email y "olvidé mi contraseña" (con pantalla para elegir la nueva, mínimo 12 caracteres). Sin configurar y en desarrollo: personas de prueba (Administrador, Auxiliar, Consulta, otro estudio, dada de baja). Un build de producción sin configurar no deja ingresar |
| Elegir empresa | Solo si la persona tiene más de una; con una sola entra directo |
| Facturar | Cliente y artículos con búsqueda, vista previa **calculada por el servidor** (la letra A/B/C y todos los importes), descuento al pie, servicios con fechas, emisión con clave de idempotencia |
| Comprobantes | Listado con filtros por fecha y estado, y detalle con renglones, IVA, saldo, lo acreditado y las notas; desde el detalle se **anula** (con motivo y aviso de lo que implica) o se **emite una nota de crédito** eligiendo renglones y cantidades, con vista previa. Lo que no se puede hacer aparece deshabilitado con su razón |
| Clientes y proveedores | Alta, edición con cambios mínimos, baja lógica, búsqueda, saldo del cliente; errores del servidor campo por campo |
| Artículos | Alta con precio y costo iniciales, IVA, precios por lista con fecha de vigencia |
| Compras | Listado de facturas de proveedores y **carga de una factura**: proveedor, letra, punto de venta y número, renglones con artículo o descripción libre (y cuenta del gasto), percepciones (con jurisdicción), y el **total del papel**: la pantalla muestra el total que calcula el servidor y no deja cargar si no coincide. Anular desde el detalle. El saldo de cada proveedor ("les debemos") está en Proveedores . Desde el detalle de una factura se **carga una nota de crédito** (con la factura ya elegida, y con la opción de devolver mercadería por renglón); también hay botones para notas de crédito y de débito de un proveedor, y en una nota con saldo a favor, **Aplicar el saldo a otra factura** |
| Tesorería | Pestañas **Cobros**, **Pagos**, **Cheques** y **Cajas y bancos**. En los cobros y pagos se puede usar el medio **Cheque** (recibir uno, emitir uno propio o endosar uno de la cartera); la pestaña Cheques sigue cada cheque: depositar, acreditar, rechazar o registrar el débito, con su historial. Para cobrar o pagar: elegir la persona, tildar las facturas a cancelar (con su importe), agregar medios y retenciones; el servidor devuelve el total, lo imputado, lo que queda a cuenta y el saldo de cada factura antes de registrar. Anular desde el detalle. Cajas y cuentas bancarias con saldo y movimientos. En Clientes y Proveedores, botón **Cuenta corriente** |
| Informes | Un selector con libros de IVA (ventas y compras), posición de IVA, balance de sumas y saldos, libro mayor (se elige la cuenta), libro diario, estados contables, deuda de clientes y proveedores por antigüedad y retenciones. Período con atajos (este mes, mes anterior, este año) y **Descargar CSV** con los mismos filtros |
| Ejercicios | Cada ejercicio con su estado, resultado y períodos abiertos. **Cerrar ejercicio** muestra primero la previa del servidor (ingresos, egresos, resultado, lo que lo impide y lo que va a pasar) y pide confirmar; **Reabrir** pide el motivo y solo está en el último ejercicio cerrado |
| Listas | Alta, nombre, orden y baja de las que nadie usa; **ajuste de precios por porcentaje** con vista previa exacta (base, redondeo, fecha de vigencia, aviso de lo que queda bajo el costo) |
| Stock | Existencias por depósito con aviso de mínimo, ajustes (ingreso, egreso, conteo físico), transferencias, libro de movimientos con filtros y depósitos |
| Trazabilidad (solo administradores del estudio) | Libro de eventos con filtros, detalle con antes → después y comprobación de la huella, "ver todo sobre este registro", exportación a CSV y **verificación de la cadena** (con comparación contra la cabeza guardada por fuera) |
| Estudio (solo administradores del estudio) | Personas (alta con invitación por email opcional, reenvío, baja, marca de administrador y accesos por empresa con su rol), empresas (alta lista para facturar, edición, baja, abrir), roles y permisos, y datos del estudio. Funciona sin empresa activa: quien administra un estudio recién creado entra directo acá |

El menú y los botones siguen los permisos del rol en la empresa activa (Consulta no ve “Facturar” ni “Nuevo cliente”); la API vuelve a controlar todo, el front solo evita ofrecer lo que no se puede hacer.

## Criterios

- **El front no calcula importes**: manda cantidades y precios, y muestra lo que devuelve la API. Los importes son texto decimal y solo se formatean por partes (`formato.ts`), nunca pasan por `Number`.
- **Un reintento no emite dos veces**: la clave de idempotencia se mantiene mientras el pedido sea el mismo y cambia si la persona modifica algo.
- **Sesión**: la administra `identidad.ts` (Supabase Auth con flujo PKCE; renueva el token solo). Se guarda en `sessionStorage` y se pierde al cerrar la pestaña; nunca en `localStorage`. Un 401 cierra la sesión y vuelve al ingreso.
- **Acceso ≠ autenticación**: que Supabase reconozca a la persona no alcanza; si no figura en `usuario` (alta del administrador del estudio), la API responde "sin acceso" y el front cierra la sesión. Por eso el alta libre en Supabase tiene que estar desactivada.
- **Invitaciones**: la pantalla de personas invita a través de la API (la clave de servicio nunca llega al navegador). Quien entra por el enlace de invitación llega con una cuenta sin contraseña y el front le pide elegir una antes de seguir (`identidad.ts` detecta `type=invite`).
- **El enlace por email y la recuperación responden igual exista o no la cuenta** (no revelan quién está registrado), salvo cuando se alcanzó el límite de envíos.
- **Sin CORS en desarrollo**: Vite reenvía `/api` y `/dev` a la API (`API_URL`, por defecto `http://127.0.0.1:3020`).
- Accesibilidad: etiquetas asociadas, errores con `aria-describedby`, diálogos nativos (`<dialog>`), foco visible, respeta `prefers-reduced-motion`.

## Cómo se corre

```
cd administranet-replica && npm run api:dev      # API de desarrollo en :3020 (datos en memoria)
cd administranet-replica/app && npm install      # la primera vez
cd administranet-replica/app && npm run dev      # front en http://localhost:3030
```

En Claude Code, desde el panel de vista previa: `administranet-api` y `administranet-app`.

```
npm run typecheck   # tipos
npm test            # pruebas de formato (importes exactos, fechas, CUIT) y de la identidad (Supabase simulado)
npm run build       # tipos + build de producción en dist/
```

## Falta

- Probar el ingreso contra un proyecto real de Supabase y desplegar (ver [api/LEEME.md](../api/LEEME.md#puesta-en-producción-supabase)). La configuración va en `app/.env.local` (modelo en `.env.example`): solo la URL y la clave *publishable*, que son públicas por diseño.
- MFA y pantalla de administración de personas y empresas.
- Trazabilidad en pantalla y asignación de empresas por lote. Las invitaciones por email requieren `SUPABASE_SERVICE_KEY` en el servidor; sin ella la pantalla lo avisa y la persona se invita desde el panel de Supabase.
- Remitos, notas de proveedores, asistente con Claude y emisión electrónica con CAE.
- Pruebas automáticas de pantallas (hoy la verificación fue manual contra la API real; no se pudieron tomar capturas por estar la vista previa en segundo plano).
