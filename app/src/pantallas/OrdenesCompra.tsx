// Órdenes de compra: lo que se le pide a un proveedor antes de recibir la mercadería. No mueven stock ni generan deuda: dejan asentado qué se pidió, a qué precio y para cuándo.
// Un borrador se puede modificar y borrar; una orden emitida solo se anula. El total y el cumplimiento (recibido, facturado, pendiente) los calcula el servidor.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda } from '../formato';
import type { Articulo, Deposito, OrdenCompra, OrdenCompraDetalle, Pagina, PreviaOrden, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
const ESTADO: Record<string, { texto: string; tono: 'neutro' | 'ok' | 'malo' }> = { borrador: { texto: 'Borrador', tono: 'neutro' }, confirmado: { texto: 'Emitida', tono: 'ok' }, anulado: { texto: 'Anulada', tono: 'malo' } };

export function OrdenesCompra() {
  const { puede } = useSesion();
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<OrdenCompra> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [formulario, setFormulario] = useState<OrdenCompraDetalle | 'nueva' | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  useEffect(() => { setPagina(0); }, [estado, desde, hasta, soloPendientes]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<OrdenCompra>>('/api/compras/ordenes', { estado, desde, hasta, pendiente: soloPendientes ? 'true' : '', limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [estado, desde, hasta, soloPendientes, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todas</option>{Object.entries(ESTADO).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
        <label className="btn"><input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo las que falta recibir</label>
        <div style={{ flex: 1 }} />{puede('compras.cargar') && <button className="btn primario" onClick={() => setFormulario('nueva')}>Nueva orden de compra</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay órdenes de compra">{desde || hasta || estado || soloPendientes ? 'Probá con otros filtros.' : 'Cargá una para dejar asentado lo que le pedís a un proveedor.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Orden</th><th>Fecha</th><th>Proveedor</th><th>Entrega prevista</th><th className="num">Total</th><th>Estado</th></tr></thead>
          <tbody>{datos.datos.map((o) => (
            <tr key={o.id} className="clic" onClick={() => setAbierta(o.id)}>
              <td><strong>{o.numero_formateado}</strong></td><td>{fecha(o.fecha)}</td><td>{o.proveedor}</td><td>{o.entrega_prevista ? fecha(o.entrega_prevista) : <span className="muted">—</span>}</td><td className="num">{moneda(o.total)}</td>
              <td><Etiqueta tono={ESTADO[o.estado]?.tono ?? 'neutro'}>{ESTADO[o.estado]?.texto ?? o.estado}</Etiqueta> {o.pendiente_de_recibir && <Etiqueta tono="aviso">Falta recibir</Etiqueta>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {formulario && <FormOrden orden={formulario === 'nueva' ? null : formulario} onCerrar={() => setFormulario(null)} onHecha={(id) => { setFormulario(null); setRecarga((n) => n + 1); setAbierta(id); }} />}
      {abierta !== null && !formulario && <Detalle id={abierta} onCerrar={() => setAbierta(null)} onCambio={() => setRecarga((n) => n + 1)} onModificar={(o) => { setAbierta(null); setFormulario(o); }} />}
    </>
  );
}

type Linea = { uid: number; articulo: Articulo | null; texto: string; cantidad: string; precio: string; deposito: string };
let contador = 0;
const nuevaLinea = (): Linea => ({ uid: ++contador, articulo: null, texto: '', cantidad: '1', precio: '', deposito: '' });

function FormOrden({ orden, onCerrar, onHecha }: { orden: OrdenCompraDetalle | null; onCerrar: () => void; onHecha: (id: number) => void }) {
  const avisar = useAviso();
  const [provTexto, setProvTexto] = useState(orden?.proveedor ?? '');
  const [proveedor, setProveedor] = useState<Tercero | null>(orden ? ({ id: orden.tercero_id, razon_social: orden.proveedor } as Tercero) : null);
  const [fechaO, setFechaO] = useState(orden?.fecha ?? hoyISO());
  const [entrega, setEntrega] = useState(orden?.entrega_prevista ?? '');
  const [observaciones, setObservaciones] = useState(orden?.observaciones ?? '');
  const [lineas, setLineas] = useState<Linea[]>(orden ? orden.items.map((i) => ({ uid: ++contador, articulo: i.articulo_id ? ({ id: i.articulo_id, controla_stock: true } as Articulo) : null, texto: i.descripcion, cantidad: fmtCantidad(i.cantidad), precio: i.precio_unitario, deposito: i.deposito_id ? String(i.deposito_id) : '' })) : [nuevaLinea()]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [previa, setPrevia] = useState<PreviaOrden | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<{ datos: Deposito[] }>('/api/depositos').then((r) => setDepositos(r.datos.filter((d) => d.activo))).catch(() => setDepositos([])); }, []);
  const variosDepositos = depositos.length > 1;
  const pedido = useMemo(() => {
    if (!proveedor) return null;
    const items = lineas.filter((l) => (l.articulo || l.texto.trim()) && l.cantidad.trim() && l.precio.trim()).map((l) => ({
      ...(l.articulo ? { articulo_id: l.articulo.id } : { descripcion: l.texto.trim() }), cantidad: aDecimal(l.cantidad), precio_unitario: aDecimal(l.precio), ...(variosDepositos && l.articulo?.controla_stock && l.deposito ? { deposito_id: Number(l.deposito) } : {}),
    }));
    return items.length ? { tercero_id: proveedor.id, fecha: fechaO, ...(entrega ? { entrega_prevista: entrega } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}), items } : null;
  }, [proveedor, fechaO, entrega, observaciones, lineas, variosDepositos]);
  const huella = JSON.stringify(pedido), retrasada = useRetraso(huella, 400);
  useEffect(() => {
    if (!pedido) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaOrden>('POST', '/api/compras/ordenes/calcular', pedido, { senal: ctl.signal }).then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiar = (uid: number, c: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...c } : l)));
  const indice = (uid: number) => lineas.filter((l) => (l.articulo || l.texto.trim()) && l.cantidad.trim() && l.precio.trim()).findIndex((l) => l.uid === uid);
  const errLinea = (uid: number, c: string) => { const i = indice(uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  async function guardar(emitir: boolean) {
    if (!pedido) return;
    setTrabajando(true); setError(null);
    try {
      const cuerpo = { ...pedido, confirmar: emitir };
      const r = orden ? await enviar<OrdenCompraDetalle>('PUT', `/api/compras/ordenes/${orden.id}`, cuerpo) : await enviar<OrdenCompraDetalle>('POST', '/api/compras/ordenes', cuerpo);
      avisar(emitir ? `Orden ${r.numero_formateado} emitida.` : `Borrador ${r.numero_formateado} guardado.`); onHecha(r.id);
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['tercero_id', 'fecha', 'entrega_prevista', 'items', ...lineas.flatMap((_, i) => ['articulo_id', 'descripcion', 'cantidad', 'precio_unitario', 'deposito_id'].map((c) => `items[${i}].${c}`))]);
  return (
    <Modal titulo={orden ? `Modificar el borrador ${orden.numero_formateado}` : 'Nueva orden de compra'} onCerrar={onCerrar} ancho={920}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void guardar(true); }} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Buscador<Tercero> etiqueta="Proveedor" texto={provTexto} placeholder="Buscá por nombre o CUIT" autoFocus error={campos.tercero_id}
            onTexto={(t) => { setProvTexto(t); setProveedor(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/proveedores', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
            mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{t.tipo_documento} {t.nro_documento}</span></>} onElegir={(t) => { setProveedor(t); setProvTexto(t.razon_social); }} /></div>
          <Campo etiqueta="Fecha" type="date" value={fechaO} error={campos.fecha} onChange={(e) => setFechaO(e.target.value)} />
          <Campo etiqueta="Entrega prevista" type="date" value={entrega} error={campos.entrega_prevista} ayuda="Opcional" onChange={(e) => setEntrega(e.target.value)} />
        </div>
        <h3 style={{ margin: '16px 0 6px' }}>Qué se pide</h3>
        {lineas.map((l, i) => (
          <div className="renglon renglon-compra" key={l.uid}>
            <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo o descripción' : `Renglón ${i + 1}`} texto={l.texto} placeholder="Elegí un artículo o escribí una descripción" error={errLinea(l.uid, 'articulo_id') ?? errLinea(l.uid, 'descripcion')}
              onTexto={(t) => cambiar(l.uid, { articulo: null, texto: t })} buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
              mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.controla_stock ? 'con stock' : a.tipo}</span></>} onElegir={(a) => cambiar(l.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}`, ...(!l.precio.trim() && a.costo && Number(a.costo) > 0 ? { precio: String(Number(a.costo)) } : {}) })} />
            <Campo etiqueta="Cantidad" inputMode="decimal" value={l.cantidad} error={errLinea(l.uid, 'cantidad')} onChange={(e) => cambiar(l.uid, { cantidad: e.target.value })} />
            <Campo etiqueta="Precio neto" inputMode="decimal" value={l.precio} error={errLinea(l.uid, 'precio_unitario')} onChange={(e) => cambiar(l.uid, { precio: e.target.value })} />
            <div />
            <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))}>×</button>
            {variosDepositos && l.articulo?.controla_stock && <div className="detalle-renglon"><Selector etiqueta="Recibir en" value={l.deposito} error={errLinea(l.uid, 'deposito_id')} onChange={(e) => cambiar(l.uid, { deposito: e.target.value })}><option value="">Se define al recibir</option>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector></div>}
          </div>
        ))}
        <button type="button" className="btn chico" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>+ Agregar renglón</button>
        <div className="rejilla" style={{ marginTop: 12 }}><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
        <div aria-live="polite" style={{ marginTop: 8 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && <div className="tarjeta" style={{ padding: 12 }}><p style={{ margin: 0 }}>Total estimado (sin IVA): <strong className="num">{moneda(previa.total)}</strong></p>{previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}</div>}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn" disabled={trabajando || !previa} onClick={() => void guardar(false)}>Guardar borrador</button><button type="submit" className="btn primario" disabled={trabajando || !previa}>{trabajando ? 'Guardando…' : 'Emitir orden'}</button></div>
      </form>
    </Modal>
  );
}

function Detalle({ id, onCerrar, onCambio, onModificar }: { id: number; onCerrar: () => void; onCambio: () => void; onModificar: (o: OrdenCompraDetalle) => void }) {
  const { puede } = useSesion(), avisar = useAviso();
  const [o, setO] = useState<OrdenCompraDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<OrdenCompraDetalle>(`/api/compras/ordenes/${id}`).then(setO).catch((e) => setError(e.message)); }, [id]);
  async function accion(f: () => Promise<OrdenCompraDetalle | null>, ok: string) {
    setTrabajando(true); setError(null);
    try { const r = await f(); avisar(ok); onCambio(); if (r) { setO(r); setAnulando(false); } else onCerrar(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  const puedeCargar = puede('compras.cargar'), puedeAnular = puede('compras.anular');
  return (
    <Modal titulo={o ? `Orden de compra ${o.numero_formateado}` : 'Orden de compra'} onCerrar={onCerrar} ancho={760}>
      {error && <Alerta>{error}</Alerta>}
      {!o && !error && <Cargando />}
      {o && (
        <>
          <p style={{ marginTop: 0 }}><strong>{o.proveedor}</strong> · {fecha(o.fecha)} · <Etiqueta tono={ESTADO[o.estado]?.tono ?? 'neutro'}>{ESTADO[o.estado]?.texto ?? o.estado}</Etiqueta> {o.pendiente_de_recibir && <Etiqueta tono="aviso">Falta recibir</Etiqueta>}</p>
          {o.entrega_prevista && <p className="muted" style={{ margin: '0 0 8px' }}>Entrega prevista: {fecha(o.entrega_prevista)}</p>}
          {o.observaciones && <p className="muted" style={{ whiteSpace: 'pre-line', margin: '0 0 8px' }}>{o.observaciones}</p>}
          <div className="tabla-caja"><table>
            <thead><tr><th>Descripción</th><th className="num">Pedido</th><th className="num">Precio</th><th className="num">Importe</th>{o.estado === 'confirmado' && <><th className="num">Recibido</th><th className="num">Facturado</th><th className="num">Falta</th></>}</tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.id}><td>{i.descripcion}{i.deposito && <div className="muted">en {i.deposito}</div>}</td><td className="num">{fmtCantidad(i.cantidad)}</td><td className="num">{moneda(i.precio_unitario)}</td><td className="num">{moneda(i.importe)}</td>
              {o.estado === 'confirmado' && <><td className="num">{fmtCantidad(i.recibido)}</td><td className="num">{fmtCantidad(i.facturado)}</td><td className="num">{fmtCantidad(i.pendiente)}</td></>}</tr>)}</tbody>
            <tfoot><tr><td style={{ fontWeight: 600 }}>Total (sin IVA)</td><td /><td /><td className="num" style={{ fontWeight: 600 }}>{moneda(o.total)}</td>{o.estado === 'confirmado' && <td colSpan={3} />}</tr></tfoot>
          </table></div>
          {anulando && (
            <form onSubmit={(e) => { e.preventDefault(); void accion(async () => (await enviar<OrdenCompraDetalle>('POST', `/api/compras/ordenes/${id}/anular`, { motivo: motivo.trim() })), 'Orden anulada.'); }} noValidate style={{ marginTop: 12 }}>
              <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              <div className="pie-form"><button type="button" className="btn" onClick={() => setAnulando(false)}>No anular</button><button type="submit" className="btn peligro" disabled={trabajando || motivo.trim().length < 3}>Anular orden</button></div>
            </form>
          )}
          {!anulando && (
            <div className="pie-form">
              {puedeCargar && o.acciones.borrar && <button className="btn peligro" disabled={trabajando} onClick={() => void accion(async () => { await llamar('DELETE', `/api/compras/ordenes/${id}`); return null; }, 'Borrador borrado.')}>Borrar</button>}
              {puedeCargar && o.acciones.modificar && <button className="btn" onClick={() => onModificar(o)}>Modificar</button>}
              {puedeCargar && o.acciones.emitir && <button className="btn primario" disabled={trabajando} onClick={() => void accion(() => enviar<OrdenCompraDetalle>('POST', `/api/compras/ordenes/${id}/emitir`, {}), 'Orden emitida.')}>Emitir orden</button>}
              {puedeAnular && o.acciones.anular && <button className="btn peligro" onClick={() => setAnulando(true)}>Anular</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
