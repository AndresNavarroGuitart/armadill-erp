// Alta de un ESTUDIO nuevo con su primera persona administradora. Es una tarea de quien opera la plataforma, no de la aplicación:
// usa la conexión del dueño de la base (la API no puede ejecutar fn_alta_estudio). Queda en la trazabilidad del estudio nuevo.
// Uso:  DATABASE_URL=postgres://… node api/alta_estudio.mjs --nombre "Estudio Pérez" --admin-email ana@estudio.com --admin-nombre "Ana Pérez" [--cuit 30-71234567-1]
//       (sin --aplicar solo verifica los datos y muestra qué haría; con --aplicar lo hace)
// Después: invitar a esa persona en Supabase (Authentication → Users → Invite) con el MISMO email; al primer ingreso queda vinculada.
import { cuitValido } from './validar.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida y devuelve los datos limpios, o lanza un Error con todos los problemas juntos. */
export function validarAltaEstudio({ nombre, cuit, adminEmail, adminNombre }) {
  const errores = [];
  const n = String(nombre ?? '').trim(), an = String(adminNombre ?? '').trim(), email = String(adminEmail ?? '').trim().toLowerCase();
  let c = cuit ? String(cuit).replace(/[\s-]/g, '') : null;
  if (n.length < 3 || n.length > 120) errores.push('--nombre: entre 3 y 120 caracteres');
  if (an.length < 2 || an.length > 120) errores.push('--admin-nombre: entre 2 y 120 caracteres');
  if (!EMAIL.test(email) || email.length > 120) errores.push('--admin-email: no es un email válido');
  if (c && !cuitValido(c)) errores.push('--cuit: no es un CUIT válido');
  if (errores.length) throw new Error(`Datos incorrectos:\n  - ${errores.join('\n  - ')}`);
  return { nombre: n, cuit: c, adminEmail: email, adminNombre: an };
}

/** `cliente` es un cliente de `pg` ya conectado con el usuario dueño. Todo en una transacción. */
export async function altaEstudio(cliente, datos) {
  const d = validarAltaEstudio(datos);
  await cliente.query('BEGIN');
  try {
    const { rows: [r] } = await cliente.query('select estudio_id, usuario_id from fn_alta_estudio($1, $2, $3, $4)', [d.nombre, d.cuit, d.adminEmail, d.adminNombre]);
    await cliente.query(`select set_config('app.estudio_id', $1, true)`, [String(r.estudio_id)]);
    await cliente.query(`select fn_registrar_evento('seguridad', $1, $2, 'ok', null, 'estudio', $3, null, null, 'alta_estudio.mjs', 'Alta de la plataforma')`,
      [`Se dio de alta el estudio ${d.nombre}`, `Administrador inicial: ${d.adminEmail}`, r.estudio_id]);
    await cliente.query('COMMIT');
    return { estudioId: Number(r.estudio_id), usuarioId: Number(r.usuario_id), ...d };
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') throw new Error('Ya existe una persona con ese email (el email es único en todo el sistema).');
    throw e;
  }
}

function argumentos(argv) {
  const m = new Map();
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const sig = argv[i + 1]; if (sig === undefined || sig.startsWith('--')) m.set(argv[i], true); else { m.set(argv[i], sig); i++; } }
  return m;
}

if (process.argv[1] && /alta_estudio\.mjs$/.test(process.argv[1])) {
  const a = argumentos(process.argv.slice(2));
  try {
    const datos = validarAltaEstudio({ nombre: a.get('--nombre'), cuit: a.get('--cuit'), adminEmail: a.get('--admin-email'), adminNombre: a.get('--admin-nombre') });
    if (!a.get('--aplicar')) {
      console.log(`Datos correctos. Se daría de alta el estudio "${datos.nombre}" con ${datos.adminNombre} <${datos.adminEmail}> como persona administradora.\nPara hacerlo: agregá --aplicar (con DATABASE_URL apuntando a la base).`);
    } else {
      if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
      const { default: pg } = await import('pg');
      const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1|\[::1\]/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: true } });
      await cliente.connect();
      try {
        const r = await altaEstudio(cliente, datos);
        console.log(`Listo. Estudio ${r.estudioId} "${r.nombre}", persona administradora ${r.adminEmail} (id ${r.usuarioId}).\nAhora invitala en Supabase con ese mismo email: al primer ingreso queda vinculada.`);
      } finally { await cliente.end(); }
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
