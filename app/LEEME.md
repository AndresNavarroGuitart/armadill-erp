# Front real de administraNET (primer tramo)

React + TypeScript + Vite sobre la API de `../api` (ver [api/LEEME.md](../api/LEEME.md)). Es independiente del prototipo de `../front` (que sigue siendo la referencia visual y de flujos): comparte el sistema de diseño (tokens en `src/estilos.css`) pero ya no usa datos de ejemplo en el navegador.

## Pantallas

| Pantalla | Qué hace |
|---|---|
| Ingreso | Con Supabase configurado: email y contraseña, enlace por email y "olvidé mi contraseña" (con pantalla para elegir la nueva, mínimo 12 caracteres). Sin configurar y en desarrollo: personas de prueba (Administrador, Auxiliar, Consulta, otro estudio, dada de baja). Un build de producción sin configurar no deja ingresar |
| Elegir empresa | Solo si la persona tiene más de una; con una sola entra directo |
| Facturar | Cliente y artículos con búsqueda, vista previa **calculada por el servidor** (la letra A/B/C y todos los importes), descuento al pie, servicios con fechas, emisión con clave de idempotencia |
| Comprobantes | Listado con filtros por fecha y estado, y detalle con renglones, IVA y asiento |
| Clientes y proveedores | Alta, edición con cambios mínimos, baja lógica, búsqueda, saldo del cliente; errores del servidor campo por campo |
| Artículos | Alta con precio y costo iniciales, IVA, precios por lista con fecha de vigencia |

El menú y los botones siguen los permisos del rol en la empresa activa (Consulta no ve “Facturar” ni “Nuevo cliente”); la API vuelve a controlar todo, el front solo evita ofrecer lo que no se puede hacer.

## Criterios

- **El front no calcula importes**: manda cantidades y precios, y muestra lo que devuelve la API. Los importes son texto decimal y solo se formatean por partes (`formato.ts`), nunca pasan por `Number`.
- **Un reintento no emite dos veces**: la clave de idempotencia se mantiene mientras el pedido sea el mismo y cambia si la persona modifica algo.
- **Sesión**: la administra `identidad.ts` (Supabase Auth con flujo PKCE; renueva el token solo). Se guarda en `sessionStorage` y se pierde al cerrar la pestaña; nunca en `localStorage`. Un 401 cierra la sesión y vuelve al ingreso.
- **Acceso ≠ autenticación**: que Supabase reconozca a la persona no alcanza; si no figura en `usuario` (alta del administrador del estudio), la API responde "sin acceso" y el front cierra la sesión. Por eso el alta libre en Supabase tiene que estar desactivada.
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
- Gestión de listas de precios y de stock desde la pantalla (hoy un bien con stock necesita movimientos que todavía no tienen pantalla; para facturar servicios o bienes sin control de stock ya alcanza).
- Anular y notas de crédito, compras, cobros y pagos, asistente con Claude y emisión electrónica con CAE.
- Pruebas automáticas de pantallas (hoy la verificación fue manual contra la API real; no se pudieron tomar capturas por estar la vista previa en segundo plano).
