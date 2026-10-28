# Prototipo de interfaz

Prototipo navegable (HTML + CSS + JS, sin build ni backend) para definir la dirección visual y la forma de trabajar del sistema. **Todos los datos son de ejemplo** y la emisión de CAE está **simulada**.

Ver: `http://localhost:3007/administranet-replica/front/index.html` (servidor `quick-consultant` de `.claude/launch.json`).

## Qué muestra

| Pantalla | Idea |
|---|---|
| Inicio | Una empresa "en una mirada": KPIs animados, caja y bancos con cursor, **qué hacer hoy** y próximos vencimientos |
| Estudio | La cartera completa ordenada por urgencia (semáforo); entrar a una empresa con un clic |
| Comprobantes | Listado con filtros por estado y búsqueda en vivo |
| Nueva factura | El tipo (A/B/C) se elige solo según el cliente; vista previa del comprobante en vivo; chequeos de reglas (RG 5616, fechas de servicio, total = suma de renglones); panel "cómo se lo enviamos a ARCA" |
| Paleta de comandos | `Ctrl K`: ir a una pantalla, cambiar de empresa, facturarle a un cliente |

## Decisiones de diseño

- **Se navega por intención, no por menús:** paleta de comandos y cambio de empresa siempre a mano (el estudio salta entre empresas todo el día).
- **El sistema avisa antes de que el error ocurra:** los chequeos de la factura salen de las reglas del modelo, no de un mensaje al final.
- **Paleta provisoria:** verdes y azules definidos como variables al inicio de `estilos.css` (`:root` y `[data-theme="dark"]`). Cuando esté la marca se cambian ahí y todo se re-pinta. Ámbar y rojo se usan solo para estados (vencimientos, errores).
- Tema claro y oscuro, responsive (barra inferior en celular), respeta `prefers-reduced-motion`.
- Tipografías: Bricolage Grotesque (títulos), Geist y Geist Mono (interfaz y cifras). Se cargan de Google Fonts; sin conexión cae a la tipografía del sistema.

## Para pasar a producto

Este código es de diseño: la versión real sería React + TypeScript consumiendo la API (ver el stack acordado). Los cálculos de la factura acá son una versión simple; en el producto los hace el motor de reglas de `../reglas/`.
