// Clientes y proveedores: son la misma persona con distinto rol, así que comparten la pantalla.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cuitConGuiones, moneda, nombreCondicion, CONDICIONES_IVA } from '../formato';
import type { Pagina, Tercero, TipoDocumento } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
type Rol = 'cliente' | 'proveedor';
const RUTA = { cliente: '/api/clientes', proveedor: '/api/proveedores' } as const;
const NOMBRE = { cliente: { uno: 'cliente', varios: 'Clientes' }, proveedor: { uno: 'proveedor', varios: 'Proveedores' } } as const;

export function Terceros({ rol }: { rol: Rol }) {
  const { puede } = useSesion();
  const editar = puede(rol === 'cliente' ? 'clientes.editar' : 'proveedores.editar');
  const [q, setQ] = useState('');
  const [verBajas, setVerBajas] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<Tercero> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Tercero | 'nuevo' | null>(null);
  const [recarga, setRecarga] = useState(0);
  const busqueda = useRetraso(q);

  useEffect(() => { setPagina(0); }, [busqueda, verBajas]);
  useEffect(() => {
    const ctl = new AbortController(); setError(null);
    obtener<Pagina<Tercero>>(RUTA[rol], { q: busqueda.trim() || undefined, activo: verBajas ? 'false' : 'true', limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then(setDatos).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [rol, busqueda, verBajas, pagina, recarga]);

  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="cabecera">
        <div><h1>{NOMBRE[rol].varios}</h1><p>{datos ? `${total} ${total === 1 ? 'registro' : 'registros'}` : 'Buscando…'}</p></div>
        <div className="acciones">{editar && <button className="btn primario" onClick={() => setFormulario('nuevo')}>Nuevo {NOMBRE[rol].uno}</button>}</div>
      </div>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o documento" />
        <label className="btn"><input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Ver dados de baja</label>
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo={busqueda ? 'No hay resultados' : verBajas ? 'No hay registros dados de baja' : `Todavía no cargaste ${NOMBRE[rol].varios.toLowerCase()}`}>{busqueda ? 'Probá con otro nombre o con el número de documento.' : editar ? `Usá “Nuevo ${NOMBRE[rol].uno}” para cargar el primero.` : undefined}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Nombre</th><th>Documento</th><th>Condición IVA</th>{rol === 'cliente' && <th className="num">Saldo</th>}<th /></tr></thead>
            <tbody>
              {datos.datos.map((t) => (
                <tr key={t.id} className="clic" onClick={() => setFormulario(t)}>
                  <td><strong>{t.razon_social}</strong>{t.email && <div className="muted">{t.email}</div>}</td>
                  <td className="num">{t.tipo_documento === 'SIN_IDENTIFICAR' ? 'Sin identificar' : `${t.tipo_documento} ${t.tipo_documento === 'CUIT' ? cuitConGuiones(t.nro_documento) : t.nro_documento}`}</td>
                  <td>{nombreCondicion(t.condicion_iva_codigo)}</td>
                  {rol === 'cliente' && <td className="num">{moneda(t.saldo ?? '0')}</td>}
                  <td>{t.es_cliente && t.es_proveedor && <Etiqueta tono="info">{rol === 'cliente' ? 'También proveedor' : 'También cliente'}</Etiqueta>} {!t.activo && <Etiqueta tono="aviso">De baja</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && (
        <div className="paginado">
          <span>Página {pagina + 1} de {paginas}</span>
          <span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span>
        </div>
      )}
      {formulario && <Formulario rol={rol} tercero={formulario === 'nuevo' ? null : formulario} puedeEditar={editar} onCerrar={() => setFormulario(null)} onGuardado={() => { setFormulario(null); setRecarga((n) => n + 1); }} />}
    </>
  );
}

type Valores = { tipo_documento: TipoDocumento; nro_documento: string; razon_social: string; condicion_iva_codigo: string; email: string; telefono: string; condicion_pago_dias: string; limite_credito: string; activo: boolean };
const vacio = (): Valores => ({ tipo_documento: 'CUIT', nro_documento: '', razon_social: '', condicion_iva_codigo: '1', email: '', telefono: '', condicion_pago_dias: '0', limite_credito: '', activo: true });
/** Lo que se envía a la API a partir de lo escrito: texto vacío → null, importes en decimal. */
const datosComunes = (v: Valores, esCliente: boolean) => ({
  razon_social: v.razon_social.trim(), condicion_iva_codigo: Number(v.condicion_iva_codigo), email: v.email.trim() || null, telefono: v.telefono.trim() || null,
  condicion_pago_dias: v.condicion_pago_dias === '' ? 0 : Number(v.condicion_pago_dias), ...(esCliente ? { limite_credito: aDecimal(v.limite_credito) || '0' } : {}),
});
const sinCeros = (n: string) => (n.includes('.') ? n.replace(/\.?0+$/, '') : n);
const desde = (t: Tercero): Valores => ({ tipo_documento: t.tipo_documento, nro_documento: t.nro_documento, razon_social: t.razon_social, condicion_iva_codigo: String(t.condicion_iva_codigo), email: t.email ?? '', telefono: t.telefono ?? '',
  condicion_pago_dias: String(t.condicion_pago_dias), limite_credito: t.limite_credito && Number(t.limite_credito) > 0 ? sinCeros(t.limite_credito) : '', activo: t.activo });

function Formulario({ rol, tercero, puedeEditar, onCerrar, onGuardado }: { rol: Rol; tercero: Tercero | null; puedeEditar: boolean; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [v, setV] = useState<Valores>(tercero ? desde(tercero) : vacio());
  const [error, setError] = useState<unknown>(null);
  const [guardando, setGuardando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiar = useCallback(<K extends keyof Valores>(k: K, valor: Valores[K]) => setV((a) => ({ ...a, [k]: valor })), []);
  const bloqueado = !puedeEditar;
  const esCliente = rol === 'cliente';

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setGuardando(true); setError(null);
    const comunes = datosComunes(v, esCliente);
    try {
      if (tercero) {
        const antes = datosComunes(desde(tercero), esCliente), cambios: Record<string, unknown> = {};
        for (const [k, valor] of Object.entries({ ...comunes, activo: v.activo })) if (valor !== (k === 'activo' ? tercero.activo : (antes as Record<string, unknown>)[k])) cambios[k] = valor;
        if (Object.keys(cambios).length === 0) { onCerrar(); return; }
        await enviar('PATCH', `${RUTA[rol]}/${tercero.id}`, cambios);
        avisar('Cambios guardados.');
      } else {
        await enviar('POST', RUTA[rol], { tipo_documento: v.tipo_documento, nro_documento: v.nro_documento.trim(), ...comunes });
        avisar(`${NOMBRE[rol].uno[0].toUpperCase()}${NOMBRE[rol].uno.slice(1)} cargado.`);
      }
      onGuardado();
    } catch (e) { setError(e); } finally { setGuardando(false); }
  }

  const visibles = ['tipo_documento', 'nro_documento', 'razon_social', 'condicion_iva_codigo', 'email', 'telefono', 'condicion_pago_dias', 'limite_credito'];
  const general = resumenErrores(error, visibles);
  return (
    <Modal titulo={tercero ? tercero.razon_social : `Nuevo ${NOMBRE[rol].uno}`} onCerrar={onCerrar}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        {!tercero && <Alerta tipo="info">Si la persona ya está cargada como {esCliente ? 'proveedor' : 'cliente'}, se le agrega este rol en lugar de duplicarla.</Alerta>}
        <div className="rejilla">
          <Selector etiqueta="Tipo de documento" value={v.tipo_documento} disabled={!!tercero || bloqueado} error={campos.tipo_documento} onChange={(e) => cambiar('tipo_documento', e.target.value as TipoDocumento)}>
            <option value="CUIT">CUIT</option><option value="CUIL">CUIL</option>{esCliente && <><option value="DNI">DNI</option><option value="SIN_IDENTIFICAR">Sin identificar</option></>}
          </Selector>
          <Campo etiqueta="Número de documento" value={v.tipo_documento === 'SIN_IDENTIFICAR' && !tercero ? '0' : v.nro_documento} disabled={!!tercero || bloqueado || v.tipo_documento === 'SIN_IDENTIFICAR'} inputMode="numeric" error={campos.nro_documento}
            ayuda={v.tipo_documento === 'CUIT' ? 'Con o sin guiones' : undefined} onChange={(e) => cambiar('nro_documento', e.target.value)} />
          <div className="ancho"><Campo etiqueta="Razón social o nombre" value={v.razon_social} disabled={bloqueado} error={campos.razon_social} onChange={(e) => cambiar('razon_social', e.target.value)} autoFocus={!tercero} /></div>
          <Selector etiqueta="Condición frente al IVA" value={v.condicion_iva_codigo} disabled={bloqueado} error={campos.condicion_iva_codigo} onChange={(e) => cambiar('condicion_iva_codigo', e.target.value)}>
            {Object.entries(CONDICIONES_IVA).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Selector>
          <Campo etiqueta="Correo electrónico" type="email" value={v.email} disabled={bloqueado} error={campos.email} onChange={(e) => cambiar('email', e.target.value)} />
          <Campo etiqueta="Teléfono" value={v.telefono} disabled={bloqueado} error={campos.telefono} onChange={(e) => cambiar('telefono', e.target.value)} />
          <Campo etiqueta="Plazo de pago (días)" type="number" min={0} max={365} value={v.condicion_pago_dias} disabled={bloqueado} error={campos.condicion_pago_dias} onChange={(e) => cambiar('condicion_pago_dias', e.target.value)} />
          {esCliente && <Campo etiqueta="Límite de crédito" inputMode="decimal" value={v.limite_credito} disabled={bloqueado} error={campos.limite_credito} ayuda="Vacío o 0 = sin límite. Solo avisa, no bloquea." onChange={(e) => cambiar('limite_credito', e.target.value)} />}
          {tercero && <label className="btn"><input type="checkbox" checked={v.activo} disabled={bloqueado} onChange={(e) => cambiar('activo', e.target.checked)} /> Activo (si lo desmarcás, no aparece al facturar)</label>}
        </div>
        {tercero && esCliente && tercero.saldo != null && <p className="muted">Saldo actual: <strong className="num">{moneda(tercero.saldo)}</strong></p>}
        <div className="pie-form">
          <button type="button" className="btn" onClick={onCerrar}>{bloqueado ? 'Cerrar' : 'Cancelar'}</button>
          {!bloqueado && <button type="submit" className="btn primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>}
        </div>
      </form>
    </Modal>
  );
}
