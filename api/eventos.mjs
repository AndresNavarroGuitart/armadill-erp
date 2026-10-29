// Rastro de cada cambio en la trazabilidad (tabla evento). Se escribe en la MISMA transacción que el cambio: si el cambio se deshace,
// el rastro también; y si el rastro falla, el cambio no se hace. Quién, cuándo y la numeración los pone la base, no la API.
import net from 'node:net';

export async function registrarEvento(c, ctx, { categoria, accion, detalle, entidad, entidadId, cambios, origen, resultado = 'ok' }) {
  const ip = origen && net.isIP(origen.ip || '') ? origen.ip : null;
  const lista = cambios && cambios.length ? JSON.stringify(cambios.map(([campo, antes, despues]) => ({ campo, antes, despues }))) : null;
  await c.consultar(`select fn_registrar_evento($1, $2, $3, $10, $4, $5, $6, $7::jsonb, $8::inet, $9)`,
    [categoria, accion, detalle ?? null, ctx.empresaId, entidad ?? null, entidadId ?? null, lista, ip, origen && origen.dispositivo ? String(origen.dispositivo).slice(0, 200) : null, resultado]);
}
