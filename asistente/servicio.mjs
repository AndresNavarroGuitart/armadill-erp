// Servicio del asistente (fase 1: guías y conceptos, SIN datos de las empresas).
// Orquesta: permisos → entrada → cuota → Claude (con caché) → limpieza de la salida → registro de uso.
// Todo lo externo se inyecta (proveedor de Claude, cuota, registro), así se prueba sin red y sin gastar.
import { cargarSecciones, construirCorpus, huellaCorpus } from './corpus.mjs';
import { promptFijo, contextoConsulta } from './prompt.mjs';
import { validarEntrada, limpiarHistorial, crearFiltro, calcularCosto } from './seguridad.mjs';
import { responderBasico } from './basico.mjs';

export const MODELO_PREDETERMINADO = 'claude-opus-5-5';   // decisión 12.1 del plan: Claude Opus 5.5 con esfuerzo bajo
const AVISO_MODO_BASICO = {
  apagado: 'El asistente avanzado está apagado para este estudio: te respondo con la guía básica.',
  cuota_diaria: 'Llegaste al máximo de consultas del día con el asistente avanzado: te respondo con la guía básica.',
  tope_mensual: 'El estudio llegó al tope de uso del mes: te respondo con la guía básica.',
  error: 'El asistente avanzado no está disponible en este momento: te respondo con la guía básica.',
  rechazado: 'No pude responder eso con el asistente avanzado: te respondo con la guía básica.',
};

export function crearServicio({ proveedor, cuota, registrarUso, registrarEvento, secciones = cargarSecciones(), modelo = MODELO_PREDETERMINADO,
  esfuerzo = 'low', maxTokens = 2000, ttlCache = '5m', apagadoGlobal = () => false, ahora = () => new Date(), reloj = () => performance.now() } = {}) {
  const corpus = construirCorpus(secciones), fijo = promptFijo(corpus), huella = huellaCorpus(corpus);

  /* Pedido a Claude. El comienzo (reglas + guía) no cambia entre consultas: ahí va el caché. Lo variable va después. */
  function armarPedido({ ctx, historial, pregunta }) {
    const hoy = ahora().toISOString().slice(0, 10);
    return {
      model: modelo,
      max_tokens: maxTokens,
      output_config: { effort: esfuerzo },                      // en Claude Opus 5.5 el pensamiento no se apaga: se controla con el esfuerzo
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                                      // si un clasificador declina, la API reintenta sola con otro modelo
      system: [
        { type: 'text', text: fijo, cache_control: ttlCache === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } },
        { type: 'text', text: contextoConsulta({ fecha: hoy, condicionIva: ctx.condicionIva, rol: ctx.rol }) },
      ],
      messages: [...historial, { role: 'user', content: pregunta }],
    };
  }

  async function* respuestaBasica({ ctx, pregunta, motivo, inicio, resultado }) {
    const r = responderBasico(pregunta, secciones), aviso = AVISO_MODO_BASICO[motivo];
    yield { tipo: 'texto', texto: `${aviso ? aviso + '\n\n' : ''}${r.texto}` };
    if (r.acciones.length) yield { tipo: 'acciones', acciones: r.acciones };
    yield { tipo: 'fuentes', fuentes: r.encontrado ? ['guia'] : [] };
    if (r.relacionados.length) yield { tipo: 'relacionados', titulos: r.relacionados };
    const ms = Math.round(reloj() - inicio);
    await registrarUso({ ctx, modelo: 'basico', usage: {}, resultado, ms, costo: 0 });
    await registrarEvento({ ctx, accion: 'Consultó al asistente', detalle: `Modo básico · ${motivo}` });
    yield { tipo: 'fin', modo: 'basico', motivo, uso: null };
  }

  async function* conversar({ ctx, historial, pregunta, senal }) {
    const inicio = reloj();
    if (!ctx || !ctx.permisos || !ctx.permisos.has('asistente.usar')) { yield { tipo: 'error', codigo: 'permiso', mensaje: 'No tenés permiso para usar el asistente.' }; return; }
    const v = validarEntrada(pregunta);
    if (!v.ok) { yield { tipo: 'error', codigo: 'entrada', mensaje: v.error }; return; }
    const previo = limpiarHistorial(historial);

    const estado = apagadoGlobal() ? { motivo: 'apagado' } : await cuota.verificar(ctx);
    if (estado.motivo) { yield* respuestaBasica({ ctx, pregunta: v.texto, motivo: estado.motivo, inicio, resultado: estado.motivo === 'apagado' ? 'apagado' : 'cuota' }); return; }

    const filtro = crearFiltro(); let usage = null, stop = null, hubo = false;
    try {
      for await (const ev of proveedor.transmitir(armarPedido({ ctx, historial: previo, pregunta: v.texto }), { senal })) {
        if (ev.tipo === 'texto') { const t = filtro.push(ev.texto); if (t) { hubo = true; yield { tipo: 'texto', texto: t }; } }
        else if (ev.tipo === 'fin') { usage = ev.usage; stop = ev.stop_reason; }
      }
    } catch (error) {
      if (senal && senal.aborted) return;                        // la persona cerró la pantalla: no se registra como falla
      if (!hubo) { yield* respuestaBasica({ ctx, pregunta: v.texto, motivo: 'error', inicio, resultado: 'error' }); return; }
      yield { tipo: 'texto', texto: '\n\n(Se cortó la respuesta. Probá de nuevo.)' };
      stop = 'error';
    }
    const resto = filtro.fin(); if (resto) { hubo = true; yield { tipo: 'texto', texto: resto }; }

    if (stop === 'refusal' && !hubo) { yield* respuestaBasica({ ctx, pregunta: v.texto, motivo: 'rechazado', inicio, resultado: 'rechazado' }); return; }
    if (stop === 'refusal') yield { tipo: 'texto', texto: '\n\n(La respuesta se interrumpió. Probá reformular la pregunta.)' };
    if (stop === 'max_tokens') yield { tipo: 'texto', texto: '\n\n(La respuesta quedó cortada por su largo. Pedime que continúe o hacé una pregunta más puntual.)' };

    if (filtro.acciones.length) yield { tipo: 'acciones', acciones: filtro.acciones };
    const fuente = filtro.fuente || 'ref';                       // si el modelo no marcó la fuente, se toma la más prudente
    yield { tipo: 'fuentes', fuentes: fuente === 'ninguna' ? [] : [fuente] };

    const ms = Math.round(reloj() - inicio), costo = usage ? calcularCosto(usage, modelo) : 0;
    const resultado = stop === 'refusal' ? 'rechazado' : stop === 'error' ? 'error' : 'ok';
    await registrarUso({ ctx, modelo, usage: usage || {}, resultado, ms, costo });
    await registrarEvento({ ctx, accion: 'Consultó al asistente', detalle: `Claude · ${(usage ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.output_tokens || 0) : 0).toLocaleString('es-AR')} tokens · ${resultado}` });
    yield { tipo: 'fin', modo: 'claude', uso: usage ? { entrada: usage.input_tokens || 0, cacheLectura: usage.cache_read_input_tokens || 0, cacheEscritura: usage.cache_creation_input_tokens || 0, salida: usage.output_tokens || 0, costoUsd: costo } : null, aviso: estado.aviso || false };
  }

  return { conversar, armarPedido, corpus, huella, secciones };
}
