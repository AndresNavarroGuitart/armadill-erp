# ARMADILL-ERP

<p><img src="app/public/logo.svg" alt="Logo de ARMADILL-ERP: un bicho bolita cerrado" width="96"></p>

Sistema de gestión para **estudios contables**: ventas, compras, stock, tesorería, contabilidad e impuestos, con varias empresas por estudio. Es una réplica reconstruida desde cero a partir del relevamiento de un ERP de escritorio, con base PostgreSQL, API en Node y front en React.

> **Estado:** proyecto en desarrollo con **datos de ejemplo**. No está conectado a ARCA (la facturación usa numeración interna, sin CAE) ni a ningún banco. Los archivos oficiales de ARCA (Libro IVA Digital, SICORE, SIFERE) no se generan porque esperan sus diseños oficiales verificados.

## Qué incluye

- **Ventas:** presupuesto → pedido → remito de salida → factura (con y sin remito), notas de crédito que devuelven mercadería, anulaciones con contraasiento.
- **Compras:** orden de compra → remito de entrada → factura (con y sin remito), notas de crédito y débito de proveedores.
- **Tesorería:** cobros y pagos con varios medios, retenciones, cajas y bancos, cheques (depósito, acreditación, rechazo, endoso y rebote tras el endoso) y ECHEQ como carga manual.
- **Contabilidad:** asientos automáticos, libros y balances, cierre de ejercicio, libros de IVA y planillas de trabajo.
- **Seguridad y trazabilidad:** aislamiento por empresa y por estudio a nivel de base (RLS), roles y permisos, libro de eventos encadenado por huellas.
- **Asistente con Claude** (plan en `PLAN_ASISTENTE_CLAUDE.md`).

> **Sobre el nombre:** ARMADILL-ERP es el nombre del producto. Los documentos de relevamiento (`MAPA_MENUS.md`, `PLAN_DE_REPLICA.md`, etc.) siguen diciendo "administraNET" porque ese es el nombre del ERP de escritorio original que se relevó; y la carpeta de trabajo local conserva su nombre técnico `administranet-replica`.

## Cómo está armado

| Carpeta | Qué es |
|---|---|
| `modelo/` | Modelo de datos en archivos SQL numerados, validados sobre PostgreSQL real (PGlite) |
| `api/` | API en Node (`(req, res)`, sin framework), con adaptadores para PGlite y `pg`; ver [`api/LEEME.md`](api/LEEME.md) |
| `app/` | Front React + TypeScript + Vite; ver [`app/LEEME.md`](app/LEEME.md) |
| `reglas/` | Motor de cálculo con decimales exactos (el front nunca calcula importes) |
| `arca/`, `asistente/`, `migracion/` | Armado de comprobantes para ARCA, asistente y migración desde el sistema original |
| `front/` | Prototipo visual original (referencia de diseño y flujos) |
| `docs/ayuda/` | Ayuda para quien usa el sistema |

El detalle del modelo está en [`MODELO_DATOS_REPLICA.md`](MODELO_DATOS_REPLICA.md).

## Probarlo

Requiere Node 20 o más nuevo.

```bash
npm install
npm test              # suite completa (cada prueba de la API corre sobre PGlite y sobre el adaptador pg)
npm run api:dev       # API de desarrollo en el puerto 3020, con datos de ejemplo en memoria
cd app && npm install && npm run dev   # front en el puerto 3030
```

El servidor de desarrollo no arranca con `NODE_ENV=production` y los datos viven en memoria. En desarrollo se entra eligiendo una persona de prueba; la autenticación real usa Supabase (ver `app/.env.example`).

## Licencia

Sin licencia por ahora: todos los derechos reservados hasta que se defina una.
