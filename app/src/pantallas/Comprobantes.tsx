import { useEffect, useState } from 'react';
import { obtener } from '../api';
import { cantidad, fecha, moneda } from '../formato';
import type { Comprobante, ComprobanteResumen, Pagina } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, Selector, Vacio } from '../ui';

const POR_PAGINA = 25;
const ESTADOS: Record<string, { texto: string; tono: 'ok' | 'aviso' | 'malo' | 'neutro' }> = {
  borrador: { texto: 'Borrador', tono: 'neutro' }, confirmado: { texto: 'Confirmado', tono: 'ok' }, autorizado: { texto: 'Autorizado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' },
};

export function Comprobantes() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<ComprobanteResumen> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);

  useEffect(() => { setPagina(0); }, [desde, hasta, estado]);
  useEffect(() => {
    const ctl = new AbortController(); setError(null);
    obtener<Pagina<ComprobanteResumen>>('/api/comprobantes', { desde, hasta, estado, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then(setDatos).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [desde, hasta, estado, pagina]);

  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="cabecera"><div><h1>Comprobantes</h1><p>{datos ? `${total} ${total === 1 ? 'comprobante' : 'comprobantes'}` : 'Buscando…'}</p></div></div>
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
      {abierto !== null && <Detalle id={abierto} onCerrar={() => setAbierto(null)} />}
    </>
  );
}

function Detalle({ id, onCerrar }: { id: number; onCerrar: () => void }) {
  const [c, setC] = useState<Comprobante | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { obtener<Comprobante>(`/api/comprobantes/${id}`).then(setC).catch((e) => setError(e.message)); }, [id]);
  return (
    <Modal titulo={c ? `${c.tipo} ${c.numero_formateado ?? ''}` : 'Comprobante'} onCerrar={onCerrar} ancho={640}>
      {error && <Alerta>{error}</Alerta>}
      {!c && !error && <Cargando />}
      {c && (
        <>
          <p style={{ marginTop: 0 }}><strong>{c.cliente}</strong> · {fecha(c.fecha)} · <Etiqueta tono={ESTADOS[c.estado]?.tono ?? 'neutro'}>{ESTADOS[c.estado]?.texto ?? c.estado}</Etiqueta></p>
          <div className="tabla-caja">
            <table>
              <thead><tr><th>Descripción</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Importe</th></tr></thead>
              <tbody>{c.items.map((it, i) => <tr key={i}><td>{it.descripcion}</td><td className="num">{cantidad(it.cantidad)}</td><td className="num">{moneda(it.precio_unitario)}</td><td className="num">{moneda(it.importe_renglon)}</td></tr>)}</tbody>
            </table>
          </div>
          <dl className="previa" style={{ marginTop: 12 }}>
            <dl style={{ margin: 0 }}>
              <dt>Neto gravado</dt><dd>{moneda(c.imp_neto)}</dd>
              {c.ivas.filter((x) => Number(x.importe_iva) !== 0).map((x) => <><dt key={`t${x.alicuota}`}>IVA {x.alicuota.replace('.', ',')} %</dt><dd key={`d${x.alicuota}`}>{moneda(x.importe_iva)}</dd></>)}
              {Number(c.imp_op_ex) > 0 && <><dt>Exento</dt><dd>{moneda(c.imp_op_ex)}</dd></>}
              {Number(c.imp_tot_conc) > 0 && <><dt>No gravado</dt><dd>{moneda(c.imp_tot_conc)}</dd></>}
              <dt className="total"><strong>Total</strong></dt><dd className="total"><strong>{moneda(c.imp_total)}</strong></dd>
            </dl>
          </dl>
          <p className="muted">{c.cae ? `CAE ${c.cae}` : 'Sin CAE: numeración interna (ARCA se conecta en un próximo paso).'}{c.asiento ? ` · Asiento ${c.asiento.estado}` : ''}</p>
        </>
      )}
    </Modal>
  );
}
