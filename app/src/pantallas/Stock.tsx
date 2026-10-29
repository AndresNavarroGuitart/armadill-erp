// Stock: existencias por depósito, libro de movimientos (solo se agrega: un error se corrige con el movimiento contrario), ajustes,
// conteos físicos, transferencias y depósitos. El servidor impone las reglas (saldo negativo, depósito activo, etc.) y sus mensajes se muestran tal cual.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, moneda } from '../formato';
import type { Articulo, Deposito, Existencia, Movimiento, Pagina } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

type Pestana = 'existencias' | 'movimientos' | 'depositos';
const TIPOS_MOV: Record<string, string> = { compra: 'Compra', venta: 'Venta', devolucion_venta: 'Devolución de venta', devolucion_compra: 'Devolución de compra', ajuste: 'Ajuste', inventario: 'Conteo físico', transferencia_entrada: 'Transferencia (entra)', transferencia_salida: 'Transferencia (sale)' };
const POR_PAGINA = 25;

export function Stock() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<Pestana>('existencias');
  const [depositos, setDepositos] = useState<Deposito[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => { obtener<{ datos: Deposito[] }>('/api/depositos').then((r) => { setDepositos(r.datos); setError(null); }).catch((e) => setError(e.message)); }, [recarga]);
  const refrescar = () => setRecarga((n) => n + 1);
  const ajusta = puede('stock.ajustar');
  return (
    <>
      <div className="cabecera"><div><h1>Stock</h1><p>Existencias por depósito. Cada cambio queda en el libro de movimientos.</p></div></div>
      <div className="pestanas" role="tablist" aria-label="Stock">
        {([['existencias', 'Existencias'], ['movimientos', 'Movimientos'], ['depositos', 'Depósitos']] as [Pestana, string][]).map(([k, n]) => <button key={k} role="tab" id={`tab-${k}`} aria-selected={pestana === k} aria-controls={`panel-${k}`} className="pestana" onClick={() => setPestana(k)}>{n}</button>)}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!error && !depositos && <Cargando />}
      {depositos && (
        <div role="tabpanel" id={`panel-${pestana}`} aria-labelledby={`tab-${pestana}`}>
          {pestana === 'existencias' && <Existencias depositos={depositos} puedeAjustar={ajusta} onCambio={refrescar} />}
          {pestana === 'movimientos' && <Movimientos depositos={depositos} />}
          {pestana === 'depositos' && <Depositos depositos={depositos} puedeAjustar={ajusta} onCambio={refrescar} />}
        </div>
      )}
    </>
  );
}

/* ====================== Existencias ====================== */
function Existencias({ depositos, puedeAjustar, onCambio }: { depositos: Deposito[]; puedeAjustar: boolean; onCambio: () => void }) {
  const [q, setQ] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<Existencia> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [modal, setModal] = useState<{ tipo: 'ajuste' | 'transferencia'; articulo?: Existencia } | null>(null);
  const busqueda = useRetraso(q);
  const activos = depositos.filter((d) => d.activo);

  useEffect(() => { setPagina(0); }, [busqueda, soloBajo]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<Existencia>>('/api/stock', { q: busqueda.trim() || undefined, bajo_minimo: soloBajo ? 'true' : undefined, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [busqueda, soloBajo, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const saldoEn = (e: Existencia, id: number) => e.por_deposito.find((p) => p.deposito_id === id)?.saldo ?? '0';

  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o nombre" />
        <label className="btn"><input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo bajo el mínimo</label>
        <div style={{ flex: 1 }} />
        {puedeAjustar && <><button className="btn" onClick={() => setModal({ tipo: 'transferencia' })} disabled={activos.length < 2} title={activos.length < 2 ? 'Hace falta más de un depósito' : undefined}>Transferir</button><button className="btn primario" onClick={() => setModal({ tipo: 'ajuste' })}>Ajustar stock</button></>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo={soloBajo ? 'Nada está por debajo del mínimo' : q ? 'No hay resultados' : 'Todavía no hay artículos con control de stock'}>{!q && !soloBajo ? 'Los bienes se cargan en Artículos; después se les da stock con “Ajustar stock”.' : undefined}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Artículo</th>{activos.map((d) => <th key={d.id} className="num">{d.nombre}</th>)}<th className="num">Total</th><th className="num">Mínimo</th><th /></tr></thead>
            <tbody>
              {datos.datos.map((e) => (
                <tr key={e.articulo_id} className={puedeAjustar ? 'clic' : undefined} onClick={puedeAjustar ? () => setModal({ tipo: 'ajuste', articulo: e }) : undefined}>
                  <td><strong>{e.nombre}</strong><div className="muted">{e.codigo}</div></td>
                  {activos.map((d) => <td key={d.id} className="num">{fmtCantidad(saldoEn(e, d.id))}</td>)}
                  <td className="num"><strong>{fmtCantidad(e.total)}</strong></td><td className="num">{e.stock_minimo ? fmtCantidad(e.stock_minimo) : <span className="muted">—</span>}</td>
                  <td>{e.bajo_minimo && <Etiqueta tono="aviso">Reponer</Etiqueta>} {Number(e.total) < 0 && <Etiqueta tono="malo">Negativo</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {modal?.tipo === 'ajuste' && <FormAjuste depositos={activos} inicial={modal.articulo} onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); setRecarga((n) => n + 1); onCambio(); }} />}
      {modal?.tipo === 'transferencia' && <FormTransferencia depositos={activos} onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); setRecarga((n) => n + 1); onCambio(); }} />}
    </>
  );
}

const buscarArticulos = (q: string) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos.filter((a) => a.controla_stock));
const mostrarArticulo = (a: Articulo) => <><span>{a.codigo} · {a.nombre}</span></>;

function SelectorArticulo({ texto, setTexto, onElegir, error, autoFoco }: { texto: string; setTexto: (t: string) => void; onElegir: (a: Articulo | null) => void; error?: string; autoFoco?: boolean }) {
  return <Buscador<Articulo> etiqueta="Artículo" texto={texto} placeholder="Código o nombre" error={error} autoFocus={autoFoco}
    onTexto={(t) => { setTexto(t); onElegir(null); }} buscar={buscarArticulos} mostrar={mostrarArticulo} onElegir={(a) => { onElegir(a); setTexto(`${a.codigo} · ${a.nombre}`); }} />;
}
async function saldoDe(articuloId: number, codigo: string): Promise<Record<number, string>> {
  const r = await obtener<Pagina<Existencia>>('/api/stock', { q: codigo, limite: 100 });
  const e = r.datos.find((x) => x.articulo_id === articuloId);
  return Object.fromEntries((e?.por_deposito ?? []).map((p) => [p.deposito_id, p.saldo]));
}

function FormAjuste({ depositos, inicial, onCerrar, onGuardado }: { depositos: Deposito[]; inicial?: Existencia; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [articulo, setArticulo] = useState<{ id: number; nombre: string; codigo: string } | null>(inicial ? { id: inicial.articulo_id, nombre: inicial.nombre, codigo: inicial.codigo } : null);
  const [texto, setTexto] = useState(inicial ? `${inicial.codigo} · ${inicial.nombre}` : '');
  const [tipo, setTipo] = useState<'ingreso' | 'egreso' | 'conteo'>('ingreso');
  const [deposito, setDeposito] = useState(String(depositos[0]?.id ?? ''));
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [costo, setCosto] = useState('');
  const [saldos, setSaldos] = useState<Record<number, string>>(inicial ? Object.fromEntries(inicial.por_deposito.map((p) => [p.deposito_id, p.saldo])) : {});
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  useEffect(() => { if (articulo && !inicial) saldoDe(articulo.id, articulo.codigo).then(setSaldos).catch(() => setSaldos({})); }, [articulo, inicial]);
  const saldoActual = saldos[Number(deposito)] ?? '0';

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try {
      const r = await enviar<{ saldo_despues: string; articulo: { nombre: string } }>('POST', '/api/stock/ajustes', {
        articulo_id: articulo?.id, deposito_id: Number(deposito), tipo, cantidad: aDecimal(cantidad), motivo: motivo.trim(), ...(tipo === 'ingreso' && costo.trim() ? { costo_unitario: aDecimal(costo) } : {}),
      });
      avisar(`${r.articulo.nombre}: ahora hay ${fmtCantidad(r.saldo_despues)}.`); onGuardado();
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['articulo_id', 'deposito_id', 'tipo', 'cantidad', 'motivo', 'costo_unitario', 'fecha']);
  return (
    <Modal titulo="Ajustar stock" onCerrar={onCerrar}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><SelectorArticulo texto={texto} setTexto={setTexto} onElegir={(a) => setArticulo(a ? { id: a.id, nombre: a.nombre, codigo: a.codigo } : null)} error={campos.articulo_id} autoFoco={!inicial} /></div>
          <Selector etiqueta="Qué querés hacer" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} ayuda={tipo === 'conteo' ? 'Cargá lo que CONTASTE: el sistema registra la diferencia contra lo que hay.' : undefined}>
            <option value="ingreso">Ingreso (suma)</option><option value="egreso">Egreso (resta)</option><option value="conteo">Conteo físico (inventario)</option>
          </Selector>
          <Selector etiqueta="Depósito" value={deposito} error={campos.deposito_id} onChange={(e) => setDeposito(e.target.value)} ayuda={articulo ? `Hay ahora: ${fmtCantidad(saldoActual)}` : undefined}>
            {depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </Selector>
          <Campo etiqueta={tipo === 'conteo' ? 'Cantidad contada' : 'Cantidad'} inputMode="decimal" value={cantidad} error={campos.cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus={!!inicial} />
          {tipo === 'ingreso' && <Campo etiqueta="Costo unitario" inputMode="decimal" value={costo} error={campos.costo_unitario} ayuda="Opcional" onChange={(e) => setCosto(e.target.value)} />}
          <div className="ancho"><Campo etiqueta="Motivo" value={motivo} error={campos.motivo} placeholder="Ej.: inventario inicial, merma, conteo de octubre" onChange={(e) => setMotivo(e.target.value)} /></div>
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !articulo || !cantidad.trim() || motivo.trim().length < 3}>{trabajando ? 'Guardando…' : 'Registrar'}</button></div>
      </form>
    </Modal>
  );
}

function FormTransferencia({ depositos, onCerrar, onGuardado }: { depositos: Deposito[]; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [articulo, setArticulo] = useState<{ id: number; nombre: string; codigo: string } | null>(null);
  const [texto, setTexto] = useState('');
  const [origen, setOrigen] = useState(String(depositos[0]?.id ?? ''));
  const [destino, setDestino] = useState(String(depositos[1]?.id ?? ''));
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saldos, setSaldos] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  useEffect(() => { if (articulo) saldoDe(articulo.id, articulo.codigo).then(setSaldos).catch(() => setSaldos({})); }, [articulo]);

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try {
      const r = await enviar<{ saldo_origen: string; saldo_destino: string; origen: string; destino: string }>('POST', '/api/stock/transferencias', { articulo_id: articulo?.id, deposito_origen_id: Number(origen), deposito_destino_id: Number(destino), cantidad: aDecimal(cantidad), ...(motivo.trim() ? { motivo: motivo.trim() } : {}) });
      avisar(`Transferido: ${r.origen} quedó con ${fmtCantidad(r.saldo_origen)} y ${r.destino} con ${fmtCantidad(r.saldo_destino)}.`); onGuardado();
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['articulo_id', 'deposito_origen_id', 'deposito_destino_id', 'cantidad', 'motivo', 'fecha']);
  return (
    <Modal titulo="Transferir entre depósitos" onCerrar={onCerrar}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><SelectorArticulo texto={texto} setTexto={setTexto} onElegir={(a) => setArticulo(a ? { id: a.id, nombre: a.nombre, codigo: a.codigo } : null)} error={campos.articulo_id} autoFoco /></div>
          <Selector etiqueta="Sale de" value={origen} error={campos.deposito_origen_id} ayuda={articulo ? `Hay: ${fmtCantidad(saldos[Number(origen)] ?? '0')}` : undefined} onChange={(e) => setOrigen(e.target.value)}>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector>
          <Selector etiqueta="Entra en" value={destino} error={campos.deposito_destino_id} ayuda={articulo ? `Hay: ${fmtCantidad(saldos[Number(destino)] ?? '0')}` : undefined} onChange={(e) => setDestino(e.target.value)}>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector>
          <Campo etiqueta="Cantidad" inputMode="decimal" value={cantidad} error={campos.cantidad} onChange={(e) => setCantidad(e.target.value)} />
          <Campo etiqueta="Motivo" value={motivo} error={campos.motivo} ayuda="Opcional" onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !articulo || !cantidad.trim() || origen === destino}>{trabajando ? 'Transfiriendo…' : 'Transferir'}</button></div>
      </form>
    </Modal>
  );
}

/* ====================== Movimientos ====================== */
function Movimientos({ depositos }: { depositos: Deposito[] }) {
  const [deposito, setDeposito] = useState('');
  const [tipo, setTipo] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<Movimiento> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setPagina(0); }, [deposito, tipo, desde, hasta]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<Movimiento>>('/api/stock/movimientos', { deposito_id: deposito, tipo, desde, hasta, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [deposito, tipo, desde, hasta, pagina]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Selector etiqueta="Depósito" value={deposito} onChange={(e) => setDeposito(e.target.value)}><option value="">Todos</option>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector>
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{Object.entries(TIPOS_MOV).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay movimientos" >Probá con otro período o tipo.</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Fecha</th><th>Artículo</th><th>Depósito</th><th className="num">Cantidad</th><th>Tipo</th><th>Detalle</th></tr></thead>
            <tbody>
              {datos.datos.map((m) => (
                <tr key={m.id}>
                  <td>{fecha(m.fecha)}</td><td><strong>{m.articulo}</strong><div className="muted">{m.codigo}</div></td><td>{m.deposito}</td>
                  <td className="num" style={{ color: Number(m.cantidad) < 0 ? 'var(--bad)' : 'var(--brand-ink)' }}>{Number(m.cantidad) > 0 ? '+' : ''}{fmtCantidad(m.cantidad)}</td>
                  <td>{TIPOS_MOV[m.tipo] ?? m.tipo}</td><td>{m.comprobante ? `Factura ${m.comprobante}` : m.motivo ?? ''}{m.costo_unitario && <div className="muted">Costo {moneda(m.costo_unitario)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
    </>
  );
}

/* ====================== Depósitos ====================== */
function Depositos({ depositos, puedeAjustar, onCambio }: { depositos: Deposito[]; puedeAjustar: boolean; onCambio: () => void }) {
  const [abierto, setAbierto] = useState<Deposito | 'nuevo' | null>(null);
  return (
    <>
      <div className="herramientas"><p className="muted" style={{ margin: 0, flex: 1 }}>Un depósito con existencias no se puede dar de baja, y la empresa siempre conserva al menos uno activo.</p>{puedeAjustar && <button className="btn primario" onClick={() => setAbierto('nuevo')}>Nuevo depósito</button>}</div>
      <div className="tabla-caja">
        <table>
          <thead><tr><th>Depósito</th><th className="num">Artículos con stock</th><th /></tr></thead>
          <tbody>{depositos.map((d) => <tr key={d.id} className={puedeAjustar ? 'clic' : undefined} onClick={puedeAjustar ? () => setAbierto(d) : undefined}><td><strong>{d.nombre}</strong></td><td className="num">{d.articulos_con_stock}</td><td>{!d.activo && <Etiqueta tono="aviso">De baja</Etiqueta>}</td></tr>)}</tbody>
        </table>
      </div>
      {abierto && <FormDeposito deposito={abierto === 'nuevo' ? null : abierto} onCerrar={() => setAbierto(null)} onGuardado={() => { setAbierto(null); onCambio(); }} />}
    </>
  );
}
function FormDeposito({ deposito, onCerrar, onGuardado }: { deposito: Deposito | null; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState(deposito?.nombre ?? '');
  const [activo, setActivo] = useState(deposito?.activo ?? true);
  const [error, setError] = useState<unknown>(null);
  const campos = useMemo(() => (error instanceof ErrorApi ? error.campos : {}), [error]);
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    try {
      if (!deposito) await enviar('POST', '/api/depositos', { nombre: nombre.trim() });
      else { const c: Record<string, unknown> = {}; if (nombre.trim() !== deposito.nombre) c.nombre = nombre.trim(); if (activo !== deposito.activo) c.activo = activo; if (Object.keys(c).length) await enviar('PATCH', `/api/depositos/${deposito.id}`, c); }
      avisar('Depósito guardado.'); onGuardado();
    } catch (e) { setError(e); }
  }
  const general = resumenErrores(error, ['nombre']);
  return (
    <Modal titulo={deposito ? deposito.nombre : 'Nuevo depósito'} onCerrar={onCerrar} ancho={460}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <Campo etiqueta="Nombre" value={nombre} error={campos.nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        {deposito && <label className="btn" style={{ marginTop: 10 }}><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>}
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={nombre.trim().length < 2}>Guardar</button></div>
      </form>
    </Modal>
  );
}
