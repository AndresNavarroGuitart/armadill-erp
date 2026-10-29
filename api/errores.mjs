// Errores de la API. Lo que ve la persona es siempre un mensaje claro en español; nunca una traza ni un detalle interno.

export class ErrorApi extends Error {
  constructor(estado, codigo, mensaje, campos) { super(mensaje); this.estado = estado; this.codigo = codigo; this.campos = campos; }
}
export const noEncontrado = (que = 'El registro') => new ErrorApi(404, 'no_encontrado', `${que} no existe o no pertenece a esta empresa.`);
export const invalido = (campos, mensaje = 'Hay datos que corregir.') => new ErrorApi(422, 'dato_invalido', mensaje, campos);

/* Los errores de la base (restricciones, disparadores) se traducen. Los que la propia base levanta con un mensaje pensado
   para la persona (SQLSTATE P0001, por ejemplo "Stock negativo…" o "período no aceptado") se muestran; el resto, no. */
export function traducir(error, registrar = () => {}) {
  if (error instanceof ErrorApi) return { estado: error.estado, cuerpo: { error: { codigo: error.codigo, mensaje: error.message, ...(error.campos ? { campos: error.campos } : {}) } } };
  const c = error && error.code;
  const salida = (estado, codigo, mensaje) => ({ estado, cuerpo: { error: { codigo, mensaje } } });
  if (c === '23505') return salida(409, 'duplicado', 'Ya existe un registro con esos datos.');
  if (c === '23514') return salida(422, 'dato_invalido', 'Algún dato no cumple las reglas del sistema. Revisá lo que cargaste.');
  if (c === '23503') return salida(422, 'referencia_invalida', 'Hay un dato que apunta a algo que no existe.');
  if (c === '23502') return salida(422, 'dato_faltante', 'Falta completar un dato obligatorio.');
  if (c === '42501') return salida(403, 'sin_permiso', 'No tenés permiso para hacer eso.');
  if (c === 'P0001' && error.message) return salida(422, 'regla_de_negocio', String(error.message).replace(/^error:\s*/i, ''));
  registrar(error);
  return salida(500, 'interno', 'Algo salió mal. Probá de nuevo en un momento.');
}
