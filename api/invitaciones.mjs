// Invitaciones por email a través de Supabase Auth (POST /auth/v1/invite). Usa la clave de SERVICIO del proyecto, que puede todo sobre las
// cuentas: vive solo en el servidor (variable de entorno), nunca se envía al navegador, no se registra y no aparece en ningún mensaje de error.
// Dos protecciones de diseño:
//   - el email al que se invita sale de la base (de la persona que cargó el administrador), nunca del pedido: la ruta no se puede usar para
//     mandar correos a direcciones cualquiera;
//   - la respuesta del proveedor no se reenvía tal cual: se traduce a un estado o a un mensaje propio.
import { ErrorApi } from './errores.mjs';

export function crearInvitador({ url, claveServicio, urlRetorno, buscar = fetch, tiempoMaximoMs = 8000, registrarError = () => {} }) {
  if (!url || !claveServicio || !urlRetorno) throw new Error('Para invitar hacen falta la URL de Supabase, la clave de servicio y la URL de la aplicación.');
  const base = url.replace(/\/+$/, '');
  return {
    /** Devuelve { estado: 'invitada' | 'ya_tiene_cuenta' } o lanza un ErrorApi con un mensaje apto para mostrar. */
    async invitar(email) {
      let r;
      try {
        r = await buscar(`${base}/auth/v1/invite?redirect_to=${encodeURIComponent(urlRetorno)}`, {
          method: 'POST', signal: AbortSignal.timeout(tiempoMaximoMs),
          headers: { 'Content-Type': 'application/json', apikey: claveServicio, Authorization: `Bearer ${claveServicio}` }, body: JSON.stringify({ email }),
        });
      } catch (e) {
        registrarError(new Error(e?.name === 'TimeoutError' ? 'invitación: el proveedor no respondió a tiempo' : 'invitación: no se pudo conectar con el proveedor'));
        throw new ErrorApi(e?.name === 'TimeoutError' ? 504 : 502, 'proveedor_identidad', 'No se pudo contactar al servicio de ingreso. Probá de nuevo en unos minutos.');
      }
      if (r.ok) return { estado: 'invitada' };
      let cuerpo = null; try { cuerpo = await r.json(); } catch (e) { /* sin cuerpo útil */ }
      const codigo = String(cuerpo?.error_code ?? cuerpo?.code ?? ''), texto = String(cuerpo?.msg ?? cuerpo?.message ?? cuerpo?.error_description ?? '');
      if (codigo === 'email_exists' || codigo === 'user_already_exists' || /already (been )?registered|already exists/i.test(texto)) return { estado: 'ya_tiene_cuenta' };
      if (r.status === 429 || /rate_limit/.test(codigo)) throw new ErrorApi(429, 'invitaciones_limitadas', 'El servicio de correo alcanzó su límite de envíos. Probá de nuevo en unos minutos.');
      // Se registra solo el estado y el código del proveedor: ni el cuerpo completo ni, por supuesto, la clave.
      registrarError(new Error(`invitación: el proveedor respondió ${r.status}${codigo ? ` (${codigo.slice(0, 60)})` : ''}`));
      if (r.status === 401 || r.status === 403) throw new ErrorApi(502, 'proveedor_identidad', 'El servidor no pudo autenticarse con el servicio de ingreso. Avisá a quien administra la plataforma.');
      throw new ErrorApi(502, 'proveedor_identidad', 'El servicio de ingreso no pudo enviar la invitación. Probá de nuevo en unos minutos.');
    },
  };
}
