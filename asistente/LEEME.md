# Asistente con Claude — fase 1

Servicio del asistente para el producto real: **guías y conceptos, sin datos de las empresas** (eso es la fase 2). Diseño completo en [../PLAN_ASISTENTE_CLAUDE.md](../PLAN_ASISTENTE_CLAUDE.md). Modelo decidido: **Claude Opus 5.5 con esfuerzo bajo**.

## Qué hay

| Archivo | Para qué |
|---|---|
| [../docs/ayuda/*.md](../docs/ayuda/) | La guía: 36 secciones (cómo hacer cosas y conceptos). **Una sola fuente**: de acá sale el corpus del modelo, el modo básico y, más adelante, la ayuda del producto |
| `corpus.mjs` | Lee la guía y la arma **siempre con los mismos bytes** (condición del caché); lista de pantallas permitidas |
| `prompt.mjs` | Reglas del asistente + guía (bloque fijo, con caché) y contexto de la consulta (bloque variable) |
| `servicio.mjs` | Permisos → entrada → cuota → Claude → limpieza de la salida → registro de uso. Todo lo externo se inyecta |
| `claude.mjs` | Único archivo que conoce el SDK de Anthropic (`@anthropic-ai/sdk`) |
| `basico.mjs` | **Modo básico**: responde sin Claude, buscando en la misma guía (se usa si Claude falla, si se agotó la cuota o si el estudio lo apagó) |
| `seguridad.mjs` | Validación de la pregunta y del historial; limpieza de la salida (sin HTML, imágenes ni enlaces); marcas `[[ir:…]]` y `[[fuente:…]]`; cálculo del costo |
| `http.mjs` | `POST /api/asistente/mensajes` en streaming (SSE), CORS por lista, límite de consultas seguidas, sin detalles internos en los errores |
| `datos.mjs` | Cuota y registro de uso contra la base (con RLS) |
| `../modelo/18_asistente.sql` | `asistente_config` (por estudio), `asistente_uso` (solo agregar, **sin contenido**), vistas de uso y `fn_asistente_estado` |
| `probar_asistente.mjs` | 35 pruebas, sin red y sin gastar |
| `servidor_dev.mjs` | Servidor de desarrollo (autenticación falsa; se niega a arrancar en producción) |
| `probar_claude.mjs` | Prueba de humo contra Claude **real**: gasta ≈ US$ 0,10 |

## Cómo se usa

```bash
npm run test:asistente                  # pruebas (no gastan)
npm run asistente:dev                   # servidor de desarrollo con respuestas simuladas
node asistente/servidor_dev.mjs --claude   # el mismo servidor llamando a Claude de verdad (GASTA)
node asistente/probar_claude.mjs --acepto-el-gasto   # prueba de humo real: acepta el pedido, caché y costo
```

La clave de Claude sale del **entorno del servidor** (`ANTHROPIC_API_KEY` o un perfil de `ant auth login`). Nunca está en el código ni llega al navegador.

## Contrato de la API

`POST /api/asistente/mensajes` con `{ "pregunta": "...", "historial": [{ "rol": "user"|"assistant", "texto": "..." }] }`. Responde en streaming:

| Evento | Contenido |
|---|---|
| `texto` | fragmento ya limpio (markdown: párrafos, listas, tablas, negrita) |
| `acciones` | botones `{ ruta, etiqueta }`; la ruta es siempre una de la lista permitida |
| `fuentes` | `["guia"]`, `["ref"]` (referencia general: confirmar) o `[]` |
| `relacionados` | títulos parecidos (solo en modo básico) |
| `fin` | `modo` (`claude` o `basico`), `motivo`, uso y costo |
| `error` | `codigo` y mensaje legible, sin detalles internos |

También `GET /api/asistente/salud` (huella de la guía cargada).

## Qué cuida

- **Caché:** el bloque fijo (reglas + guía) va primero y es idéntico byte a byte; fecha y rol van después. La prueba lo verifica.
- **Salida:** nada de HTML, imágenes ni enlaces, así que una respuesta no puede filtrar datos por una URL. Las marcas se validan contra la lista de pantallas.
- **Privacidad:** al modelo no se le manda el nombre de la empresa; el registro de uso y la trazabilidad **no guardan la pregunta ni la respuesta**.
- **Gasto:** cuota diaria por persona y tope mensual por estudio (en la base), interruptor por estudio y global, límite de consultas seguidas, tope de largo de la respuesta.
- **Fallas:** si Claude falla o rechaza, responde el modo básico; si se corta a mitad, avisa; si la persona cierra la pantalla, se cancela la llamada.

## Diferencias con el diseño (decididas al construir)

- El historial lo manda el navegador (se limpia y se acota) en lugar de guardarse en el servidor: sirve en funciones sin estado y no persiste nada.
- Los botones salen de **marcas en el texto** (`[[ir:ruta|Etiqueta]]`) que el servidor valida, en vez de una herramienta: la fase 1 no usa herramientas.
- La autenticación y la conexión a la base de producción (`pg`) quedan para cuando exista la API del sistema; acá están los adaptadores y la versión con PGlite que las prueba.

## Pendiente

1. **Prueba de humo real** (pide tu aprobación porque gasta): confirma que Claude acepta el pedido y que el caché lee el corpus.
2. Conectar la pantalla del prototipo a esta API (reemplazar `responder()`).
3. Decisiones abiertas del plan: tope mensual (hoy provisorio, US$ 50), guardar conversaciones, runtime con streaming, contrato y asesoría legal.
4. Fase 2: herramientas de lectura de datos con RLS.
