# Front real de administraNET (primer tramo)

React + TypeScript + Vite sobre la API de `../api` (ver [api/LEEME.md](../api/LEEME.md)). Es independiente del prototipo de `../front` (que sigue siendo la referencia visual y de flujos): comparte el sistema de diseño (tokens en `src/estilos.css`) pero ya no usa datos de ejemplo en el navegador.

## Pantallas

| Pantalla | Qué hace |
|---|---|
| Ingreso | En desarrollo ofrece personas de prueba (Administrador, Auxiliar, Consulta, otro estudio, dada de baja). En producción será el ingreso de Supabase Auth (todavía no conectado) |
| Elegir empresa | Solo si la persona tiene más de una; con una sola entra directo |
| Facturar | Cliente y artículos con búsqueda, vista previa **calculada por el servidor** (la letra A/B/C y todos los importes), descuento al pie, servicios con fechas, emisión con clave de idempotencia |
| Comprobantes | Listado con filtros por fecha y estado, y detalle con renglones, IVA y asiento |
| Clientes y proveedores | Alta, edición con cambios mínimos, baja lógica, búsqueda, saldo del cliente; errores del servidor campo por campo |
| Artículos | Alta con precio y costo iniciales, IVA, precios por lista con fecha de vigencia |

El menú y los botones siguen los permisos del rol en la empresa activa (Consulta no ve “Facturar” ni “Nuevo cliente”); la API vuelve a controlar todo, el front solo evita ofrecer lo que no se puede hacer.

## Criterios

- **El front no calcula importes**: manda cantidades y precios, y muestra lo que devuelve la API. Los importes son texto decimal y solo se formatean por partes (`formato.ts`), nunca pasan por `Number`.
- **Un reintento no emite dos veces**: la clave de idempotencia se mantiene mientras el pedido sea el mismo y cambia si la persona modifica algo.
- **Sesión**: el token vive en `sessionStorage` (se pierde al cerrar la pestaña); un 401 limpia la sesión y vuelve al ingreso. Nunca se guarda en `localStorage`.
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
npm test            # pruebas de formato (importes exactos, fechas, CUIT)
npm run build       # tipos + build de producción en dist/
```

## Falta

- Ingreso real con Supabase Auth (y verificación ES256/JWKS en la API si corresponde) y despliegue.
- Gestión de listas de precios y de stock desde la pantalla (hoy un bien con stock necesita movimientos que todavía no tienen pantalla; para facturar servicios o bienes sin control de stock ya alcanza).
- Anular y notas de crédito, compras, cobros y pagos, asistente con Claude y emisión electrónica con CAE.
- Pruebas automáticas de pantallas (hoy la verificación fue manual contra la API real; no se pudieron tomar capturas por estar la vista previa en segundo plano).
