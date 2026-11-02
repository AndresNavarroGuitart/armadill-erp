// Pedidos de venta: lo que pide un cliente antes de que se entregue. No mueven ni reservan stock y no generan cobro: dejan asentado qué se pidió, a qué precio y para cuándo, y de ahí
// se hacen los remitos de salida. Un borrador se puede modificar y borrar; uno confirmado solo se anula. El total y el cumplimiento (remitido, facturado, pendiente) los calcula el servidor.
import { useEffect, useMemo, useState } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda, nombreCondicion } from '../formato';
import type { Articulo, Deposito, Pagina, PedidoVenta, PedidoVentaDetalle, PresupuestoVenta, PresupuestoVentaDetalle, PreviaPedidoVenta, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
const ESTADO: Record<string, { texto: string; tono: 'neutro' | 'ok' | 'malo' }> = { borrador: { texto: 'Borrador', tono: 'neutro' }, confirmado: { texto: 'Confirmado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' } };

export function PedidosVenta({ presupuestoInicial, onConsumido, onRemitir }: { presupuestoInicial: number | null; onConsumido: () => void; onRemitir: (pedidoId: number) => void }) {
  const { puede } = useSesion();
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<PedidoVenta> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [formulario, setFormulario] = useState<{ pedido: PedidoVentaDetalle | null; presupuesto: number | null } | null>(presupuestoInicial ? { pedido: null, presupuesto: presupuestoInicial } : null);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => { if (presupuestoInicial) onConsumido(); }, [presupuestoInicial, onConsumido]);
  useEffect(() => { setPagina(0); }, [estado, desde, hasta, soloPendientes]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<PedidoVenta>>('/api/ventas/pedidos', { estado, desde, hasta, pendiente: soloPendientes ? 'true' : '', limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [estado, desde, hasta, soloPendientes, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADO).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
        <label className="btn"><input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo los que falta entregar</label>
        <div style={{ flex: 1 }} />{puede('ventas.emitir') && <button className="btn primario" onClick={() => setFormulario({ pedido: null, presupuesto: null })}>Nuevo pedido</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay pedidos de venta">{desde || hasta || estado || soloPendientes ? 'Probá con otros filtros.' : 'Cargá un pedido para dejar asentado lo que te pide un cliente y entregarlo después con un remito.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Presupuesto</th><th>Entrega prevista</th><th className="num">Total</th><th>Estado</th></tr></thead>
          <tbody>{datos.datos.map((p) => (
            <tr key={p.id} className="clic" onClick={() => setAbierto(p.id)}>
              <td><strong>{p.numero_formateado}</strong></td><td>{fecha(p.fecha)}</td><td>{p.cliente}</td><td>{p.presupuesto?.numero_formateado ?? <span className="muted">—</span>}</td><td>{p.entrega_prevista ? fecha(p.entrega_prevista) : <span className="muted">—</span>}</td><td className="num">{moneda(p.total)}</td>
              <td><Etiqueta tono={ESTADO[p.estado]?.tono ?? 'neutro'}>{ESTADO[p.estado]?.texto ?? p.estado}</Etiqueta> {p.pendiente_de_remitir && <Etiqueta tono="aviso">Falta entregar</Etiqueta>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {formulario && <FormPedido pedido={formulario.pedido} presupuestoInicial={formulario.presupuesto} onCerrar={() => setFormulario(null)} onHecho={(id) => { setFormulario(null); setRecarga((n) => n + 1); setAbierto(id); }} />}
      {abierto !== null && !formulario && <Detalle id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} onModificar={(p) => { setAbierto(null); setFormulario({ pedido: p, presupuesto: p.presupuesto?.id ?? null }); }} onRemitir={(id) => { setAbierto(null); onRemitir(id); }} />}
    </>
  );
}

type Linea = { uid: number; origenId: number | null; articulo: Articulo | null; texto: string; cantidad: string; precio: string; deposito: string; pendiente?: string };
let contador = 0;
const nuevaLinea = (): Linea => ({ uid: ++contador, origenId: null, articulo: null, texto: '', cantidad: '1', precio: '', deposito: '' });

function FormPedido({ pedido, presupuestoInicial, onCerrar, onHecho }: { pedido: PedidoVentaDetalle | null; presupuestoInicial: number | null; onCerrar: () => void; onHecho: (id: number) => void }) {
  const avisar = useAviso();
  const [presupuestos, setPresupuestos] = useState<PresupuestoVenta[]>([]);
  const [presupuestoId, setPresupuestoId] = useState(presupuestoInicial ? String(presupuestoInicial) : '');
  const [presupuestoSel, setPresupuestoSel] = useState<PresupuestoVentaDetalle | null>(null);
  const [cliTexto, setCliTexto] = useState(pedido?.cliente ?? '');
  const [cliente, setCliente] = useState<Tercero | null>(pedido ? ({ id: pedido.tercero_id, razon_social: pedido.cliente } as Tercero) : null);
  const [fechaP, setFechaP] = useState(pedido?.fecha ?? hoyISO());
  const [entrega, setEntrega] = useState(pedido?.entrega_prevista ?? '');
  const [observaciones, setObservaciones] = useState(pedido?.observaciones ?? '');
  const [lineas, setLineas] = useState<Linea[]>(pedido ? pedido.items.map((i) => ({ uid: ++contador, origenId: i.item_origen_id, articulo: i.articulo_id ? ({ id: i.articulo_id, controla_stock: false } as Articulo) : null, texto: i.descripcion, cantidad: fmtCantidad(i.cantidad), precio: fmtCantidad(i.precio_unitario), deposito: i.deposito_id ? String(i.deposito_id) : '' })) : [nuevaLinea()]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [previa, setPrevia] = useState<PreviaPedidoVenta | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<{ datos: Deposito[] }>('/api/ventas/depositos').then((r) => setDepositos(r.datos.filter((d) => d.activo))).catch(() => setDepositos([])); }, []);
  useEffect(() => {
    Promise.all(['vigente', 'aceptado_parcial'].map((situacion) => obtener<Pagina<PresupuestoVenta>>('/api/ventas/presupuestos', { situacion, limite: 100 }))).then((r) => setPresupuestos(r.flatMap((x) => x.datos))).catch(() => setPresupuestos([]));
  }, []);
  // al elegir el presupuesto, los renglones son los del presupuesto con lo que falta pedir (o, al modificar, lo que ya tenía el borrador)
  useEffect(() => {
    if (!presupuestoId) { setPresupuestoSel(null); return; }
    obtener<PresupuestoVentaDetalle>(`/api/ventas/presupuestos/${presupuestoId}`).then((q) => {
      setPresupuestoSel(q); setCliente({ id: q.tercero_id, razon_social: q.cliente } as Tercero); setCliTexto(q.cliente);
      setLineas(q.items.filter((i) => Number(i.pendiente) > 0 || pedido?.items.some((x) => x.item_origen_id === i.id)).map((i) => {
        const propio = pedido?.items.find((x) => x.item_origen_id === i.id);
        return { uid: ++contador, origenId: i.id, articulo: i.articulo_id ? ({ id: i.articulo_id } as Articulo) : null, texto: i.descripcion, cantidad: propio ? fmtCantidad(propio.cantidad) : fmtCantidad(i.pendiente), precio: '', deposito: propio?.deposito_id ? String(propio.deposito_id) : '', pendiente: i.pendiente };
      }));
    }).catch((e) => setError(e));
  }, [presupuestoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const conPresupuesto = presupuestoId !== '';
  const completas = (ls: Linea[]) => ls.filter((l) => (conPresupuesto ? l.origenId : l.articulo) && l.cantidad.trim() && Number(aDecimal(l.cantidad)) > 0);
  const cuerpo = useMemo(() => {
    const usadas = completas(lineas);
    if (!usadas.length || !cliente) return null;
    return {
      ...(conPresupuesto ? { presupuesto_id: Number(presupuestoId) } : { tercero_id: cliente.id }), fecha: fechaP, ...(entrega ? { entrega_prevista: entrega } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      items: usadas.map((l) => ({ ...(conPresupuesto ? { item_origen_id: l.origenId } : { articulo_id: l.articulo!.id }), cantidad: aDecimal(l.cantidad), ...(l.precio.trim() ? { precio_unitario: aDecimal(l.precio) } : {}), ...(l.deposito ? { deposito_id: Number(l.deposito) } : {}) })),
    };
  }, [lineas, cliente, fechaP, entrega, observaciones, conPresupuesto, presupuestoId]);
  const huella = JSON.stringify(cuerpo), retrasada = useRetraso(huella, 400);
  useEffect(() => {
    if (!cuerpo) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaPedidoVenta>('POST', '/api/ventas/pedidos/calcular', cuerpo, { senal: ctl.signal }).then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiar = (uid: number, c: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...c } : l)));
  const errLinea = (uid: number, c: string) => { const i = completas(lineas).findIndex((l) => l.uid === uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  async function guardar(confirmar: boolean) {
    if (!cuerpo) return;
    setTrabajando(true); setError(null);
    try {
      const pedidoCuerpo = { ...cuerpo, confirmar };
      const r = pedido ? await enviar<PedidoVentaDetalle>('PUT', `/api/ventas/pedidos/${pedido.id}`, pedidoCuerpo) : await enviar<PedidoVentaDetalle>('POST', '/api/ventas/pedidos', pedidoCuerpo);
      avisar(confirmar ? `Pedido ${r.numero_formateado} confirmado.` : `Borrador ${r.numero_formateado} guardado.`); onHecho(r.id);
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['presupuesto_id', 'tercero_id', 'fecha', 'entrega_prevista', 'items', ...lineas.flatMap((_, i) => ['item_origen_id', 'articulo_id', 'cantidad', 'precio_unitario', 'deposito_id'].map((c) => `items[${i}].${c}`))]);
  return (
    <Modal titulo={pedido ? `Modificar el borrador ${pedido.numero_formateado}` : 'Nuevo pedido de venta'} onCerrar={onCerrar} ancho={920}>
      <form onSubmit={(e) => { e.preventDefault(); void guardar(true); }} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Selector etiqueta="Contra el presupuesto" value={presupuestoId} disabled={!!pedido?.presupuesto} error={campos.presupuesto_id} onChange={(e) => { setPresupuestoId(e.target.value); if (!e.target.value) { setLineas([nuevaLinea()]); setCliente(null); setCliTexto(''); } }}>
            <option value="">Sin presupuesto (pedido directo)</option>{presupuestoInicial && !presupuestos.some((x) => x.id === presupuestoInicial) && <option value={presupuestoInicial}>Presupuesto {presupuestoInicial}</option>}
            {presupuestos.map((x) => <option key={x.id} value={x.id}>{x.numero_formateado} · {x.cliente} · {fecha(x.fecha)} · {moneda(x.total)}</option>)}</Selector></div>
          {!conPresupuesto && <div className="ancho"><Buscador<Tercero> etiqueta="Cliente" texto={cliTexto} placeholder="Buscá por nombre o documento" error={campos.tercero_id}
            onTexto={(t) => { setCliTexto(t); setCliente(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/clientes', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
            mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{nombreCondicion(t.condicion_iva_codigo)}</span></>} onElegir={(t) => { setCliente(t); setCliTexto(t.razon_social); }} /></div>}
          <Campo etiqueta="Fecha del pedido" type="date" value={fechaP} error={campos.fecha} onChange={(e) => setFechaP(e.target.value)} />
          <Campo etiqueta="Entrega prevista" type="date" value={entrega} error={campos.entrega_prevista} onChange={(e) => setEntrega(e.target.value)} />
        </div>
        {conPresupuesto && presupuestoSel && <p className="muted" style={{ margin: '10px 0 0' }}>{presupuestoSel.cliente}. Cada renglón viene con lo que falta pedir del presupuesto: poné lo que el cliente pide realmente (dejá en 0 lo que no). El precio es el del presupuesto.</p>}
        <h3 style={{ margin: '16px 0 6px' }}>Qué pide</h3>
        {lineas.map((l, i) => (
          <div className="renglon renglon-compra" key={l.uid}>
            {conPresupuesto ? <div><span className="muted">{i === 0 ? 'Renglón del presupuesto' : `Renglón ${i + 1}`}</span><div><strong>{l.texto}</strong><div className="muted">Falta pedir: {fmtCantidad(l.pendiente ?? '0')}</div></div></div> : <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo' : `Renglón ${i + 1}`} texto={l.texto} placeholder="Código o nombre" error={errLinea(l.uid, 'articulo_id')}
              onTexto={(t) => cambiar(l.uid, { articulo: null, texto: t })} buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos.filter((a) => a.tipo !== 'gasto'))}
              mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.precio_neto ? moneda(a.precio_neto) : 'sin precio'}</span></>} onElegir={(a) => cambiar(l.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}` })} />}
            <Campo etiqueta="Cantidad" inputMode="decimal" value={l.cantidad} error={errLinea(l.uid, 'cantidad')} onChange={(e) => cambiar(l.uid, { cantidad: e.target.value })} />
            <Campo etiqueta="Precio neto" inputMode="decimal" value={l.precio} placeholder={l.articulo?.precio_neto ? fmtCantidad(l.articulo.precio_neto) : 'de la lista'} error={errLinea(l.uid, 'precio_unitario')} onChange={(e) => cambiar(l.uid, { precio: e.target.value })} />
            <div />
            {!conPresupuesto ? <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))}>×</button> : <div />}
            {depositos.length > 1 && <div className="detalle-renglon"><Selector etiqueta="Sale de (opcional)" value={l.deposito} error={errLinea(l.uid, 'deposito_id')} onChange={(e) => cambiar(l.uid, { deposito: e.target.value })}><option value="">Se define al entregar</option>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector></div>}
          </div>
        ))}
        {!conPresupuesto && <button type="button" className="btn chico" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>+ Agregar renglón</button>}
        <div className="rejilla" style={{ marginTop: 12 }}><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
        <div aria-live="polite" style={{ marginTop: 8 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && <div className="tarjeta" style={{ padding: 12 }}><p style={{ margin: 0 }}>Total del pedido (sin IVA): <strong className="num">{moneda(previa.total)}</strong></p>{previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}</div>}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn" disabled={trabajando || !previa} onClick={() => void guardar(false)}>Guardar borrador</button><button type="submit" className="btn primario" disabled={trabajando || !previa}>{trabajando ? 'Guardando…' : 'Confirmar pedido'}</button></div>
      </form>
    </Modal>
  );
}

function Detalle({ id, onCerrar, onCambio, onModificar, onRemitir }: { id: number; onCerrar: () => void; onCambio: () => void; onModificar: (p: PedidoVentaDetalle) => void; onRemitir: (id: number) => void }) {
  const { puede } = useSesion(), avisar = useAviso();
  const [p, setP] = useState<PedidoVentaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<PedidoVentaDetalle>(`/api/ventas/pedidos/${id}`).then(setP).catch((e) => setError(e.message)); }, [id]);
  async function accion(f: () => Promise<PedidoVentaDetalle | null>, ok: string) {
    setTrabajando(true); setError(null);
    try { const x = await f(); avisar(ok); onCambio(); if (x) { setP(x); setAnulando(false); } else onCerrar(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  const puedeEmitir = puede('ventas.emitir'), puedeAnular = puede('ventas.anular');
  const conCumplimiento = p?.estado === 'confirmado';
  return (
    <Modal titulo={p ? `Pedido de venta ${p.numero_formateado}` : 'Pedido de venta'} onCerrar={onCerrar} ancho={820}>
      {error && <Alerta>{error}</Alerta>}
      {!p && !error && <Cargando />}
      {p && (
        <>
          <p style={{ marginTop: 0 }}><strong>{p.cliente}</strong>{p.presupuesto && <> · presupuesto {p.presupuesto.numero_formateado}</>} · {fecha(p.fecha)} · <Etiqueta tono={ESTADO[p.estado]?.tono ?? 'neutro'}>{ESTADO[p.estado]?.texto ?? p.estado}</Etiqueta>{p.entrega_prevista && <> · entrega prevista {fecha(p.entrega_prevista)}</>}</p>
          {p.observaciones && <p className="muted" style={{ whiteSpace: 'pre-line', margin: '0 0 8px' }}>{p.observaciones}</p>}
          <div className="tabla-caja"><table>
            <thead><tr><th>Descripción</th><th className="num">Pedido</th><th className="num">Precio</th><th className="num">Importe</th>{conCumplimiento && <><th className="num">Entregado</th><th className="num">Facturado</th><th className="num">Falta</th></>}</tr></thead>
            <tbody>{p.items.map((i) => <tr key={i.id}><td>{i.descripcion}</td><td className="num">{fmtCantidad(i.cantidad)}</td><td className="num">{moneda(i.precio_unitario)}</td><td className="num">{moneda(i.importe)}</td>{conCumplimiento && <><td className="num">{fmtCantidad(i.remitado)}</td><td className="num">{fmtCantidad(i.facturado)}</td><td className="num">{fmtCantidad(i.pendiente)}</td></>}</tr>)}</tbody>
            <tfoot><tr><td style={{ fontWeight: 600 }}>Total (sin IVA)</td><td /><td /><td className="num" style={{ fontWeight: 600 }}>{moneda(p.total)}</td>{conCumplimiento && <><td /><td /><td /></>}</tr></tfoot>
          </table></div>
          {p.remitos.length > 0 && <p className="muted" style={{ margin: '10px 0 0' }}>Remitos: {p.remitos.map((r) => `${r.numero_formateado}${r.estado === 'anulado' ? ' (anulado)' : ''}`).join(' · ')}</p>}
          {anulando && (
            <form onSubmit={(e) => { e.preventDefault(); void accion(() => enviar<PedidoVentaDetalle>('POST', `/api/ventas/pedidos/${id}/anular`, { motivo: motivo.trim() }), 'Pedido anulado.'); }} noValidate style={{ marginTop: 12 }}>
              <Alerta tipo="aviso">Un pedido con remitos no se puede anular: anulá primero esos remitos.</Alerta>
              <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              <div className="pie-form"><button type="button" className="btn" onClick={() => setAnulando(false)}>No anular</button><button type="submit" className="btn peligro" disabled={trabajando || motivo.trim().length < 3}>Anular pedido</button></div>
            </form>
          )}
          {!anulando && (
            <div className="pie-form">
              {puedeEmitir && p.acciones.borrar && <button className="btn peligro" disabled={trabajando} onClick={() => void accion(async () => { await llamar('DELETE', `/api/ventas/pedidos/${id}`); return null; }, 'Borrador borrado.')}>Borrar</button>}
              {puedeEmitir && p.acciones.modificar && <button className="btn" onClick={() => onModificar(p)}>Modificar</button>}
              {puedeEmitir && p.acciones.confirmar && <button className="btn primario" disabled={trabajando} onClick={() => void accion(() => enviar<PedidoVentaDetalle>('POST', `/api/ventas/pedidos/${id}/confirmar`, {}), 'Pedido confirmado.')}>Confirmar pedido</button>}
              {puedeEmitir && p.acciones.remitir && <button className="btn primario" onClick={() => onRemitir(id)}>Entregar (hacer remito)</button>}
              {puedeAnular && p.acciones.anular && <button className="btn peligro" onClick={() => setAnulando(true)}>Anular</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
