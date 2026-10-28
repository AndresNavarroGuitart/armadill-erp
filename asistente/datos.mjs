// Acceso a la base del asistente: cuota y registro de uso. Reciben un "consultar(sql, parametros)" ya ubicado en el
// contexto de sesión (estudio, empresa y usuario fijados con set_config, rol app_usuario), así que la RLS manda.

export function crearCuotaPg(consultar) {
  return {
    async verificar(ctx) {
      const { rows } = await consultar('select * from fn_asistente_estado($1, $2)', [ctx.estudioId, ctx.usuarioId]);
      const e = rows[0] || {};
      return { motivo: e.motivo || null, aviso: !!e.aviso, usadasHoy: e.usadas_hoy, cuotaDiaria: e.cuota_diaria, gastoMes: Number(e.gasto_mes || 0), topeMensual: Number(e.tope_mensual || 0) };
    },
  };
}

export function crearRegistroPg(consultar) {
  return {
    /* No guarda el texto de la pregunta ni de la respuesta: solo cuánto se usó. */
    async registrarUso({ ctx, modelo, usage, resultado, ms, costo }) {
      const u = usage || {};
      await consultar(
        `insert into asistente_uso (estudio_id, empresa_id, usuario_id, modelo, tokens_entrada, tokens_cache_lectura, tokens_cache_escritura, tokens_salida, resultado, ms, costo_usd)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ctx.estudioId, ctx.empresaId || null, ctx.usuarioId, modelo, u.input_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0, u.output_tokens || 0, resultado, ms ?? null, costo || 0]);
    },
    async registrarEvento({ ctx, accion, detalle }) {
      await consultar(`select fn_registrar_evento('asistente', $1, $2, 'ok', $3)`, [accion, detalle, ctx.empresaId || null]);
    },
  };
}

/* Une las dos cosas con "conBd(ctx, fn)": ejecuta fn dentro de una transacción con el contexto de sesión y el rol de la aplicación.
   conBd(ctx, fn) recibe fn(consultar). En PGlite (pruebas y desarrollo) lo arma conBdPglite; en producción, el mismo patrón sobre `pg`. */
export function crearAdaptadoresPg(conBd) {
  return {
    cuota: { verificar: (ctx) => conBd(ctx, (c) => crearCuotaPg(c).verificar(ctx)) },
    registrarUso: (datos) => conBd(datos.ctx, (c) => crearRegistroPg(c).registrarUso(datos)),
    registrarEvento: (datos) => conBd(datos.ctx, (c) => crearRegistroPg(c).registrarEvento(datos)),
  };
}

export function conBdPglite(db) {
  return (ctx, fn) => db.transaction(async (tx) => {
    await tx.query(`select set_config('app.estudio_id', $1, true), set_config('app.empresa_id', $2, true), set_config('app.usuario_id', $3, true)`,
      [String(ctx.estudioId), ctx.empresaId ? String(ctx.empresaId) : '', String(ctx.usuarioId)]);
    await tx.query('set local role app_usuario');
    return fn((sql, params) => tx.query(sql, params));
  });
}
