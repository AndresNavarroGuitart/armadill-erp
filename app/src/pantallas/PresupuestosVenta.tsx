// Presupuestos de venta: la cotización que se le da a un cliente. No mueven ni reservan stock y no generan cobro: dejan asentado qué se ofrece, a qué precio y hasta cuándo vale. Cuando el
// cliente acepta se hace un pedido contra el presupuesto. Un borrador se puede modificar y borrar; uno emitido solo se anula. El total y la situación (vigente, vencido, aceptado) los calcula el servidor.
import { useEffect, useMemo, useState } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda, nombreCondicion } from '../formato';
import type { Articulo, Pagina, PresupuestoVenta, PresupuestoVentaDetalle, PreviaPresupuestoVenta, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
export const SITUACION: Record<string, { texto: string; tono: 'neutro' | 'ok' | 'malo' | 'aviso' }> = {
  borrador: { texto: 'Borrador', tono: 'neutro' }, vigente: { texto: 'Vigente', tono: 'ok' }, vencido: { texto: 'Vencido', tono: 'aviso' },
  aceptado_parcial: { texto: 'Aceptado en parte', tono: 'ok' }, aceptado: { texto: 'Aceptado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' },
};

export function PresupuestosVenta({ onPedir }: { onPedir: (presupuestoId: number) => void }) {
  const { puede } = useSesion();
  const [situacion, setSituacion] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<PresupuestoVenta> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [formulario, setFormulario] = useState<PresupuestoVentaDetalle | 'nuevo' | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => { setPagina(0); }, [situacion, desde, hasta]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<PresupuestoVenta>>('/api/ventas/presupuestos', { situacion, desde, hasta, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [situacion, desde, hasta, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Situación" value={situacion} onChange={(e) => setSituacion(e.target.value)}><option value="">Todas</option>{Object.entries(SITUACION).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
        <div style={{ flex: 1 }} />{puede('ventas.emitir') && <button className="btn primario" onClick={() => setFormulario('nuevo')}>Nuevo presupuesto</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay presupuestos">{desde || hasta || situacion ? 'Probá con otros filtros.' : 'Armá un presupuesto para cotizarle a un cliente; cuando lo acepte lo pasás a pedido.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Presupuesto</th><th>Fecha</th><th>Cliente</th><th>Válido hasta</th><th className="num">Total</th><th>Situación</th></tr></thead>
          <tbody>{datos.datos.map((p) => (
            <tr key={p.id} className="clic" onClick={() => setAbierto(p.id)}>
              <td><strong>{p.numero_formateado}</strong></td><td>{fecha(p.fecha)}</td><td>{p.cliente}</td><td>{p.valido_hasta ? fecha(p.valido_hasta) : <span className="muted">Sin vencimiento</span>}</td><td className="num">{moneda(p.total)}</td>
              <td><Etiqueta tono={SITUACION[p.situacion]?.tono ?? 'neutro'}>{SITUACION[p.situacion]?.texto ?? p.situacion}</Etiqueta></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {formulario && <FormPresupuesto presupuesto={formulario === 'nuevo' ? null : formulario} onCerrar={() => setFormulario(null)} onHecho={(id) => { setFormulario(null); setRecarga((n) => n + 1); setAbierto(id); }} />}
      {abierto !== null && !formulario && <Detalle id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} onModificar={(p) => { setAbierto(null); setFormulario(p); }} onPedir={(id) => { setAbierto(null); onPedir(id); }} />}
    </>
  );
}

type Linea = { uid: number; articulo: Articulo | null; texto: string; cantidad: string; precio: string };
let contador = 0;
const nuevaLinea = (): Linea => ({ uid: ++contador, articulo: null, texto: '', cantidad: '1', precio: '' });

function FormPresupuesto({ presupuesto, onCerrar, onHecho }: { presupuesto: PresupuestoVentaDetalle | null; onCerrar: () => void; onHecho: (id: number) => void }) {
  const avisar = useAviso();
  const [cliTexto, setCliTexto] = useState(presupuesto?.cliente ?? '');
  const [cliente, setCliente] = useState<Tercero | null>(presupuesto ? ({ id: presupuesto.tercero_id, razon_social: presupuesto.cliente } as Tercero) : null);
  const [fechaP, setFechaP] = useState(presupuesto?.fecha ?? hoyISO());
  const [validoHasta, setValidoHasta] = useState<string | null>(presupuesto ? presupuesto.valido_hasta : undefined as unknown as null);   // undefined: lo decide el servidor (15 días)
  const [observaciones, setObservaciones] = useState(presupuesto?.observaciones ?? '');
  const [lineas, setLineas] = useState<Linea[]>(presupuesto ? presupuesto.items.map((i) => ({ uid: ++contador, articulo: i.articulo_id ? ({ id: i.articulo_id } as Articulo) : null, texto: i.descripcion, cantidad: fmtCantidad(i.cantidad), precio: fmtCantidad(i.precio_unitario) })) : [nuevaLinea()]);
  const [previa, setPrevia] = useState<PreviaPresupuestoVenta | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const completas = (ls: Linea[]) => ls.filter((l) => l.articulo && l.cantidad.trim() && Number(aDecimal(l.cantidad)) > 0);
  const cuerpo = useMemo(() => {
    const usadas = completas(lineas);
    if (!usadas.length || !cliente) return null;
    return {
      tercero_id: cliente.id, fecha: fechaP, ...(validoHasta !== undefined ? { valido_hasta: validoHasta || null } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      items: usadas.map((l) => ({ articulo_id: l.articulo!.id, cantidad: aDecimal(l.cantidad), ...(l.precio.trim() ? { precio_unitario: aDecimal(l.precio) } : {}) })),
    };
  }, [lineas, cliente, fechaP, validoHasta, observaciones]);
  const huella = JSON.stringify(cuerpo), retrasada = useRetraso(huella, 400);
  useEffect(() => {
    if (!cuerpo) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaPresupuestoVenta>('POST', '/api/ventas/presupuestos/calcular', cuerpo, { senal: ctl.signal }).then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiar = (uid: number, c: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...c } : l)));
  const errLinea = (uid: number, c: string) => { const i = completas(lineas).findIndex((l) => l.uid === uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  async function guardar(emitir: boolean) {
    if (!cuerpo) return;
    setTrabajando(true); setError(null);
    try {
      const pedidoCuerpo = { ...cuerpo, confirmar: emitir };
      const r = presupuesto ? await enviar<PresupuestoVentaDetalle>('PUT', `/api/ventas/presupuestos/${presupuesto.id}`, pedidoCuerpo) : await enviar<PresupuestoVentaDetalle>('POST', '/api/ventas/presupuestos', pedidoCuerpo);
      avisar(emitir ? `Presupuesto ${r.numero_formateado} emitido.` : `Borrador ${r.numero_formateado} guardado.`); onHecho(r.id);
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['tercero_id', 'fecha', 'valido_hasta', 'items', ...lineas.flatMap((_, i) => ['articulo_id', 'cantidad', 'precio_unitario'].map((c) => `items[${i}].${c}`))]);
  return (
    <Modal titulo={presupuesto ? `Modificar el borrador ${presupuesto.numero_formateado}` : 'Nuevo presupuesto'} onCerrar={onCerrar} ancho={920}>
      <form onSubmit={(e) => { e.preventDefault(); void guardar(true); }} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Buscador<Tercero> etiqueta="Cliente" texto={cliTexto} placeholder="Buscá por nombre o documento" error={campos.tercero_id}
            onTexto={(t) => { setCliTexto(t); setCliente(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/clientes', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
            mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{nombreCondicion(t.condicion_iva_codigo)}</span></>} onElegir={(t) => { setCliente(t); setCliTexto(t.razon_social); }} /></div>
          <Campo etiqueta="Fecha" type="date" value={fechaP} error={campos.fecha} onChange={(e) => setFechaP(e.target.value)} />
          <Campo etiqueta="Válido hasta" type="date" value={validoHasta ?? ''} placeholder="15 días" error={campos.valido_hasta} onChange={(e) => setValidoHasta(e.target.value)} />
        </div>
        <small className="ayuda muted">Si no indicás la fecha de validez, el presupuesto vale 15 días.</small>
        <h3 style={{ margin: '16px 0 6px' }}>Qué se ofrece</h3>
        {lineas.map((l, i) => (
          <div className="renglon renglon-compra" key={l.uid}>
            <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo' : `Renglón ${i + 1}`} texto={l.texto} placeholder="Código o nombre" error={errLinea(l.uid, 'articulo_id')}
              onTexto={(t) => cambiar(l.uid, { articulo: null, texto: t })} buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos.filter((a) => a.tipo !== 'gasto'))}
              mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.precio_neto ? moneda(a.precio_neto) : 'sin precio'}</span></>} onElegir={(a) => cambiar(l.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}` })} />
            <Campo etiqueta="Cantidad" inputMode="decimal" value={l.cantidad} error={errLinea(l.uid, 'cantidad')} onChange={(e) => cambiar(l.uid, { cantidad: e.target.value })} />
            <Campo etiqueta="Precio neto" inputMode="decimal" value={l.precio} placeholder={l.articulo?.precio_neto ? fmtCantidad(l.articulo.precio_neto) : 'de la lista'} error={errLinea(l.uid, 'precio_unitario')} onChange={(e) => cambiar(l.uid, { precio: e.target.value })} />
            <div />
            <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))}>×</button>
          </div>
        ))}
        <button type="button" className="btn chico" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>+ Agregar renglón</button>
        <div className="rejilla" style={{ marginTop: 12 }}><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
        <div aria-live="polite" style={{ marginTop: 8 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && <div className="tarjeta" style={{ padding: 12 }}><p style={{ margin: 0 }}>Total del presupuesto (sin IVA): <strong className="num">{moneda(previa.total)}</strong>{previa.valido_hasta && <> · válido hasta {fecha(previa.valido_hasta)}</>}</p>{previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}</div>}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn" disabled={trabajando || !previa} onClick={() => void guardar(false)}>Guardar borrador</button><button type="submit" className="btn primario" disabled={trabajando || !previa}>{trabajando ? 'Guardando…' : 'Emitir presupuesto'}</button></div>
      </form>
    </Modal>
  );
}

function Detalle({ id, onCerrar, onCambio, onModificar, onPedir }: { id: number; onCerrar: () => void; onCambio: () => void; onModificar: (p: PresupuestoVentaDetalle) => void; onPedir: (id: number) => void }) {
  const { puede } = useSesion(), avisar = useAviso();
  const [p, setP] = useState<PresupuestoVentaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<PresupuestoVentaDetalle>(`/api/ventas/presupuestos/${id}`).then(setP).catch((e) => setError(e.message)); }, [id]);
  async function accion(f: () => Promise<PresupuestoVentaDetalle | null>, ok: string) {
    setTrabajando(true); setError(null);
    try { const x = await f(); avisar(ok); onCambio(); if (x) { setP(x); setAnulando(false); } else onCerrar(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  const puedeEmitir = puede('ventas.emitir'), puedeAnular = puede('ventas.anular');
  const conCumplimiento = p?.estado === 'confirmado';
  return (
    <Modal titulo={p ? `Presupuesto ${p.numero_formateado}` : 'Presupuesto'} onCerrar={onCerrar} ancho={820}>
      {error && <Alerta>{error}</Alerta>}
      {!p && !error && <Cargando />}
      {p && (
        <>
          <p style={{ marginTop: 0 }}><strong>{p.cliente}</strong> · {fecha(p.fecha)} · <Etiqueta tono={SITUACION[p.situacion]?.tono ?? 'neutro'}>{SITUACION[p.situacion]?.texto ?? p.situacion}</Etiqueta>{p.valido_hasta && <> · válido hasta {fecha(p.valido_hasta)}</>}</p>
          {p.observaciones && <p className="muted" style={{ whiteSpace: 'pre-line', margin: '0 0 8px' }}>{p.observaciones}</p>}
          <div className="tabla-caja"><table>
            <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Importe</th>{conCumplimiento && <><th className="num">Pedido</th><th className="num">Falta pedir</th></>}</tr></thead>
            <tbody>{p.items.map((i) => <tr key={i.id}><td>{i.descripcion}</td><td className="num">{fmtCantidad(i.cantidad)}</td><td className="num">{moneda(i.precio_unitario)}</td><td className="num">{moneda(i.importe)}</td>{conCumplimiento && <><td className="num">{fmtCantidad(i.pedido)}</td><td className="num">{fmtCantidad(i.pendiente)}</td></>}</tr>)}</tbody>
            <tfoot><tr><td style={{ fontWeight: 600 }}>Total (sin IVA)</td><td /><td /><td className="num" style={{ fontWeight: 600 }}>{moneda(p.total)}</td>{conCumplimiento && <><td /><td /></>}</tr></tfoot>
          </table></div>
          {p.pedidos.length > 0 && <p className="muted" style={{ margin: '10px 0 0' }}>Pedidos: {p.pedidos.map((r) => `${r.numero_formateado}${r.estado === 'anulado' ? ' (anulado)' : r.estado === 'borrador' ? ' (borrador)' : ''}`).join(' · ')}</p>}
          {p.situacion === 'vencido' && <Alerta tipo="aviso">El presupuesto venció: no se puede pasar a pedido. Hacé uno nuevo si el cliente lo sigue queriendo.</Alerta>}
          {anulando && (
            <form onSubmit={(e) => { e.preventDefault(); void accion(() => enviar<PresupuestoVentaDetalle>('POST', `/api/ventas/presupuestos/${id}/anular`, { motivo: motivo.trim() }), 'Presupuesto anulado.'); }} noValidate style={{ marginTop: 12 }}>
              <Alerta tipo="aviso">Un presupuesto con pedidos no se puede anular: anulá primero esos pedidos.</Alerta>
              <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              <div className="pie-form"><button type="button" className="btn" onClick={() => setAnulando(false)}>No anular</button><button type="submit" className="btn peligro" disabled={trabajando || motivo.trim().length < 3}>Anular presupuesto</button></div>
            </form>
          )}
          {!anulando && (
            <div className="pie-form">
              {puedeEmitir && p.acciones.borrar && <button className="btn peligro" disabled={trabajando} onClick={() => void accion(async () => { await llamar('DELETE', `/api/ventas/presupuestos/${id}`); return null; }, 'Borrador borrado.')}>Borrar</button>}
              {puedeEmitir && p.acciones.modificar && <button className="btn" onClick={() => onModificar(p)}>Modificar</button>}
              {puedeEmitir && p.acciones.emitir && <button className="btn primario" disabled={trabajando} onClick={() => void accion(() => enviar<PresupuestoVentaDetalle>('POST', `/api/ventas/presupuestos/${id}/emitir`, {}), 'Presupuesto emitido.')}>Emitir presupuesto</button>}
              {puedeEmitir && p.acciones.pedir && <button className="btn primario" onClick={() => onPedir(id)}>Pasar a pedido</button>}
              {puedeAnular && p.acciones.anular && <button className="btn peligro" onClick={() => setAnulando(true)}>Anular</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
