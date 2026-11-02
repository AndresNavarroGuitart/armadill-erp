import { useEffect, useState } from 'react';
import { obtener } from '../api';
import { fecha, moneda } from '../formato';
import type { ComprobanteResumen, Pagina } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Selector, Vacio } from '../ui';
import { ComprobanteDetalle, ESTADOS } from './ComprobanteDetalle';
import { PedidosVenta } from './PedidosVenta';
import { PresupuestosVenta } from './PresupuestosVenta';
import { RemitosVenta } from './RemitosVenta';

const POR_PAGINA = 25;

export function Comprobantes() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<ComprobanteResumen> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [pestana, setPestana] = useState<'facturas' | 'presupuestos' | 'pedidos' | 'remitos'>('facturas');
  const [presupuestoAPedir, setPresupuestoAPedir] = useState<number | null>(null);
  const [pedidoARemitir, setPedidoARemitir] = useState<number | null>(null);

  useEffect(() => { setPagina(0); }, [desde, hasta, estado]);
  useEffect(() => {
    const ctl = new AbortController(); setError(null);
    obtener<Pagina<ComprobanteResumen>>('/api/comprobantes', { desde, hasta, estado, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then(setDatos).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [desde, hasta, estado, pagina, recarga]);

  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="cabecera"><div><h1>Comprobantes</h1><p>{pestana === 'presupuestos' ? 'Cotizaciones a los clientes: valen hasta una fecha y, cuando se aceptan, pasan a pedido.' : pestana === 'pedidos' ? 'Lo que piden los clientes: al confirmarse reserva el stock y se entrega con un remito.' : pestana === 'remitos' ? 'Mercadería entregada a los clientes: sale del stock y se factura después.' : datos ? `${total} ${total === 1 ? 'comprobante' : 'comprobantes'}` : 'Buscando…'}</p></div></div>
      <div className="pestanas" role="tablist" aria-label="Comprobantes">
        {([['facturas', 'Facturas y notas'], ['presupuestos', 'Presupuestos'], ['pedidos', 'Pedidos'], ['remitos', 'Remitos de salida']] as ['facturas' | 'presupuestos' | 'pedidos' | 'remitos', string][]).map(([k, n]) => <button key={k} role="tab" aria-selected={pestana === k} className="pestana" onClick={() => setPestana(k)}>{n}</button>)}
      </div>
      {pestana === 'presupuestos' ? <PresupuestosVenta onPedir={(id) => { setPresupuestoAPedir(id); setPestana('pedidos'); }} /> : pestana === 'pedidos' ? <PedidosVenta presupuestoInicial={presupuestoAPedir} onConsumido={() => setPresupuestoAPedir(null)} onRemitir={(id) => { setPedidoARemitir(id); setPestana('remitos'); }} /> : pestana === 'remitos' ? <RemitosVenta pedidoInicial={pedidoARemitir} onConsumido={() => setPedidoARemitir(null)} /> : <>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay comprobantes" >{desde || hasta || estado ? 'Probá con otro período o estado.' : 'Cuando emitas facturas van a aparecer acá.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th className="num">Total</th><th>Estado</th></tr></thead>
            <tbody>
              {datos.datos.map((c) => (
                <tr key={c.id} className="clic" onClick={() => setAbierto(c.id)}>
                  <td><strong>{c.tipo} {c.numero_formateado ?? '—'}</strong></td>
                  <td>{fecha(c.fecha)}</td><td>{c.cliente}</td><td className="num">{moneda(c.imp_total)}</td>
                  <td><Etiqueta tono={ESTADOS[c.estado]?.tono ?? 'neutro'}>{ESTADOS[c.estado]?.texto ?? c.estado}</Etiqueta></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && (
        <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>
      )}
      </>}
      {abierto !== null && <ComprobanteDetalle id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} onAbrir={(id) => setAbierto(id)} />}
    </>
  );
}
