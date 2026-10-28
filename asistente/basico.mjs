// Modo básico: responde SIN llamar a Claude, buscando en la misma guía. Se usa cuando la API de Claude no está disponible,
// el estudio apagó el asistente o se agotó la cuota. Es lo que hacía el prototipo, pero sobre los archivos de docs/ayuda.
import { RUTAS } from './corpus.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
const PARADAS = new Set(['como', 'que', 'cual', 'cuales', 'donde', 'para', 'por', 'con', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'mis', 'mas', 'muy', 'hay', 'esta', 'este', 'esto', 'puedo', 'hacer', 'hago', 'tengo', 'quiero', 'necesito', 'sistema', 'favor', 'hola', 'gracias', 'dos', 'son']);
const raiz = (t) => (t.length > 4 ? t.slice(0, 4) : t.replace(/s$/, ''));
const tokens = (s) => norm(s).split(' ').filter((t) => t.length >= 3 && !PARADAS.has(t)).map(raiz);
const SUGERENCIAS = ['¿Cómo emito una factura?', '¿Cuáles son las alícuotas de IVA?', '¿Cómo concilio el banco?', '¿Cómo registro un cobro?', '¿Cómo cierro un período?'];

export function responderBasico(pregunta, secciones) {
  const q = new Set(tokens(pregunta)), n = norm(pregunta);
  const puntuadas = secciones.map((s) => {
    let p = 0; const acreditadas = new Set();               // una palabra no suma dos veces ("factura", "factura a", "factura b"…)
    for (const partes of s.claves.map(tokens).filter((x) => x.length).sort((a, b) => b.length - a.length)) {
      if (!(partes.length > 1 ? partes.every((x) => q.has(x)) : q.has(partes[0]))) continue;
      if (partes.every((x) => acreditadas.has(x))) continue;
      p += partes.length > 1 ? 4 : 2; partes.forEach((x) => acreditadas.add(x));
    }
    const titulo = new Set(tokens(s.titulo)); for (const t of titulo) if (q.has(t)) p += 1;
    return [s, p];
  }).sort((a, b) => b[1] - a[1]);
  const [mejor, puntos] = puntuadas[0];
  const pideDatos = /\b(saldo|debo|deben|me debe|stock de|hay de)\b/.test(n) || /\bquien(es)?\b.*\b(debe|deben|compro|compraron)\b/.test(n) || /\bcuant\w*\b.*\b(debo|deben|tengo|hay|queda|quedan|pagar|cobrar|vendi|facture|stock|saldo)\b/.test(n);
  const minimo = q.size <= 3 ? 2 : 3;                      // una pregunta corta tiene pocas palabras que sumar
  if (puntos < minimo || (pideDatos && puntos < 6)) {
    return { encontrado: false, texto: pideDatos
      ? 'Todavía no puedo consultar los datos de la empresa (saldos, stock, deudas). Se ven en la pantalla correspondiente del sistema.\n\nPuedo explicarte cómo hacer algo o qué significa un concepto. Por ejemplo:\n' + SUGERENCIAS.map((s) => `- ${s}`).join('\n')
      : 'No tengo una respuesta segura para eso. Probá escribirla de otra forma, o con alguna de estas:\n' + SUGERENCIAS.map((s) => `- ${s}`).join('\n') + '\n\nSi es una consulta contable o impositiva de fondo, conviene confirmarla con el contador o en ARCA.',
    acciones: [], relacionados: [] };
  }
  const relacionados = puntuadas.slice(1, 3).filter(([, p]) => p >= 3).map(([s]) => s.titulo);
  return { encontrado: true, seccion: mejor.id, texto: `**${mejor.titulo}**\n\n${mejor.texto}`, acciones: mejor.rutas.slice(0, 3).map((ruta) => ({ ruta, etiqueta: RUTAS[ruta] })), relacionados };
}
