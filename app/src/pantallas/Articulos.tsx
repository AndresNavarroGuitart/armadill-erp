// Artículos con su precio neto por lista (con vigencia). El IVA se calcula al facturar: acá se carga siempre el precio SIN IVA.
import { useEffect, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, fecha, hoyISO, moneda } from '../formato';
import type { Articulo, Lista, Pagina } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
const ALICUOTAS = ['21', '10.5', '27', '5', '2.5', '0'];
const TIPOS = { bien: 'Bien (lleva stock)', servicio: 'Servicio', gasto: 'Gasto', bien_de_uso: 'Bien de uso' } as const;
const TRATAMIENTOS = { gravado: 'Gravado', exento: 'Exento', no_gravado: 'No gravado' } as const;
type Precio = { lista_id: number; lista: string; vigente_desde: string; precio_neto: string };
type Detalle = Articulo & { precios: Precio[] };

export function Articulos() {
  const { puede } = useSesion();
  const editar = puede('articulos.editar');
  const [listas, setListas] = useState<Lista[]>([]);
  const [listaId, setListaId] = useState('');
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<Articulo> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | 'nuevo' | null>(null);
  const [recarga, setRecarga] = useState(0);
  const busqueda = useRetraso(q);

  useEffect(() => { obtener<{ datos: Lista[] }>('/api/listas-precio').then((r) => { setListas(r.datos); setListaId((a) => a || String(r.datos[0]?.id ?? '')); }).catch((e) => setError(e.message)); }, [recarga]);
  useEffect(() => { setPagina(0); }, [busqueda, tipo, listaId]);
  useEffect(() => {
    const ctl = new AbortController(); setError(null);
    obtener<Pagina<Articulo>>('/api/articulos', { q: busqueda.trim() || undefined, tipo: tipo || undefined, lista_id: listaId || undefined, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then(setDatos).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [busqueda, tipo, listaId, pagina, recarga]);

  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="cabecera">
        <div><h1>Artículos</h1><p>Precios netos (sin IVA) por lista.</p></div>
        <div className="acciones">{editar && <button className="btn primario" onClick={() => setAbierto('nuevo')}>Nuevo artículo</button>}</div>
      </div>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o nombre" />
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{Object.entries(TIPOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
        <Selector etiqueta="Lista de precios" value={listaId} onChange={(e) => setListaId(e.target.value)}>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Selector>
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo={busqueda || tipo ? 'No hay resultados' : 'Todavía no cargaste artículos'}>{editar && !busqueda ? 'Usá “Nuevo artículo” para cargar el primero.' : undefined}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Código</th><th>Nombre</th><th>IVA</th><th className="num">Precio neto</th><th /></tr></thead>
            <tbody>
              {datos.datos.map((a) => (
                <tr key={a.id} className="clic" onClick={() => setAbierto(a.id)}>
                  <td className="num" style={{ textAlign: 'left' }}>{a.codigo}</td>
                  <td><strong>{a.nombre}</strong><div className="muted">{TIPOS[a.tipo]}</div></td>
                  <td>{a.tratamiento_iva_venta === 'gravado' ? `${a.alicuota_venta?.replace('.', ',')} %` : TRATAMIENTOS[a.tratamiento_iva_venta]}</td>
                  <td className="num">{a.precio_neto ? moneda(a.precio_neto) : <span className="muted">sin precio</span>}</td>
                  <td>{!a.activo && <Etiqueta tono="aviso">De baja</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && (
        <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>
      )}
      {abierto !== null && <Formulario id={abierto === 'nuevo' ? null : abierto} listas={listas} puedeEditar={editar} onCerrar={() => setAbierto(null)} onGuardado={(cierra) => { if (cierra) setAbierto(null); setRecarga((n) => n + 1); }} />}
    </>
  );
}

type Valores = { codigo: string; nombre: string; tipo: Articulo['tipo']; tratamiento: Articulo['tratamiento_iva_venta']; alicuota: string; controla_stock: boolean; activo: boolean; lista_id: string; precio_neto: string; costo: string };

function Formulario({ id, listas, puedeEditar, onCerrar, onGuardado }: { id: number | null; listas: Lista[]; puedeEditar: boolean; onCerrar: () => void; onGuardado: (cerrar: boolean) => void }) {
  const avisar = useAviso();
  const [original, setOriginal] = useState<Detalle | null>(null);
  const [v, setV] = useState<Valores>({ codigo: '', nombre: '', tipo: 'bien', tratamiento: 'gravado', alicuota: '21', controla_stock: true, activo: true, lista_id: String(listas[0]?.id ?? ''), precio_neto: '', costo: '' });
  const [cargando, setCargando] = useState(id !== null);
  const [error, setError] = useState<unknown>(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevo, setNuevo] = useState({ lista_id: String(listas[0]?.id ?? ''), precio: '', desde: hoyISO() });
  const [errorPrecio, setErrorPrecio] = useState<unknown>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const set = <K extends keyof Valores>(k: K, valor: Valores[K]) => setV((a) => ({ ...a, [k]: valor }));
  const bloqueado = !puedeEditar;

  useEffect(() => {
    if (id === null) return;
    obtener<Detalle>(`/api/articulos/${id}`).then((a) => {
      setOriginal(a); setV((x) => ({ ...x, codigo: a.codigo, nombre: a.nombre, tipo: a.tipo, tratamiento: a.tratamiento_iva_venta, alicuota: a.alicuota_venta ?? '21', controla_stock: a.controla_stock, activo: a.activo }));
    }).catch((e) => setError(e)).finally(() => setCargando(false));
  }, [id]);

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setGuardando(true); setError(null);
    const base = { nombre: v.nombre.trim(), tratamiento_iva_venta: v.tratamiento, ...(v.tratamiento === 'gravado' ? { alicuota_venta: v.alicuota } : {}), controla_stock: v.controla_stock };
    try {
      if (original) {
        const antes: Record<string, unknown> = { nombre: original.nombre, tratamiento_iva_venta: original.tratamiento_iva_venta, alicuota_venta: original.alicuota_venta ?? undefined, controla_stock: original.controla_stock, activo: original.activo };
        const cambios = Object.fromEntries(Object.entries({ ...base, activo: v.activo }).filter(([k, valor]) => antes[k] !== valor));
        if (Object.keys(cambios).length) { await enviar('PATCH', `/api/articulos/${original.id}`, cambios); avisar('Cambios guardados.'); }
        onGuardado(true);
      } else {
        const extra = v.precio_neto.trim() ? { lista_id: Number(v.lista_id), precio_neto: aDecimal(v.precio_neto) } : {};
        await enviar('POST', '/api/articulos', { codigo: v.codigo.trim(), tipo: v.tipo, ...base, ...extra, ...(v.costo.trim() ? { costo: aDecimal(v.costo) } : {}) });
        avisar('Artículo cargado.'); onGuardado(true);
      }
    } catch (e) { setError(e); } finally { setGuardando(false); }
  }

  async function cambiarPrecio() {
    if (!original) return;
    setErrorPrecio(null);
    try {
      await enviar('PUT', `/api/articulos/${original.id}/precios`, { lista_id: Number(nuevo.lista_id), precio_neto: aDecimal(nuevo.precio), vigente_desde: nuevo.desde });
      avisar('Precio guardado.'); setNuevo((n) => ({ ...n, precio: '' }));
      setOriginal(await obtener<Detalle>(`/api/articulos/${original.id}`)); onGuardado(false);
    } catch (e) { setErrorPrecio(e); }
  }

  const visibles = ['codigo', 'nombre', 'tipo', 'tratamiento_iva_venta', 'alicuota_venta', 'lista_id', 'precio_neto', 'costo', 'controla_stock'];
  const general = resumenErrores(error, visibles), generalPrecio = resumenErrores(errorPrecio, ['lista_id', 'precio_neto', 'vigente_desde']);
  const camposPrecio = errorPrecio instanceof ErrorApi ? errorPrecio.campos : {};
  return (
    <Modal titulo={original ? original.nombre : 'Nuevo artículo'} onCerrar={onCerrar} ancho={640}>
      {cargando ? <Cargando /> : (
        <>
          <form onSubmit={guardar} noValidate>
            {general && <Alerta>{general}</Alerta>}
            <div className="rejilla">
              <Campo etiqueta="Código" value={v.codigo} disabled={!!original || bloqueado} error={campos.codigo} ayuda={original ? undefined : 'Se guarda en mayúsculas'} onChange={(e) => set('codigo', e.target.value)} autoFocus={!original} />
              <Selector etiqueta="Tipo" value={v.tipo} disabled={!!original || bloqueado} error={campos.tipo} onChange={(e) => { const t = e.target.value as Articulo['tipo']; setV((a) => ({ ...a, tipo: t, controla_stock: t === 'bien' })); }}>
                {Object.entries(TIPOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </Selector>
              <div className="ancho"><Campo etiqueta="Nombre" value={v.nombre} disabled={bloqueado} error={campos.nombre} onChange={(e) => set('nombre', e.target.value)} /></div>
              <Selector etiqueta="IVA en ventas" value={v.tratamiento} disabled={bloqueado} error={campos.tratamiento_iva_venta} onChange={(e) => set('tratamiento', e.target.value as Valores['tratamiento'])}>
                {Object.entries(TRATAMIENTOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </Selector>
              {v.tratamiento === 'gravado' && <Selector etiqueta="Alícuota" value={v.alicuota} disabled={bloqueado} error={campos.alicuota_venta} onChange={(e) => set('alicuota', e.target.value)}>{ALICUOTAS.map((a) => <option key={a} value={a}>{a.replace('.', ',')} %</option>)}</Selector>}
              <label className="btn"><input type="checkbox" checked={v.controla_stock} disabled={bloqueado} onChange={(e) => set('controla_stock', e.target.checked)} /> Controla stock</label>
              {original && <label className="btn"><input type="checkbox" checked={v.activo} disabled={bloqueado} onChange={(e) => set('activo', e.target.checked)} /> Activo</label>}
              {!original && !bloqueado && (
                <>
                  <Selector etiqueta="Lista del precio inicial" value={v.lista_id} error={campos.lista_id} onChange={(e) => set('lista_id', e.target.value)}>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Selector>
                  <Campo etiqueta="Precio neto inicial" inputMode="decimal" value={v.precio_neto} error={campos.precio_neto} ayuda="Sin IVA. Opcional." onChange={(e) => set('precio_neto', e.target.value)} />
                  <Campo etiqueta="Costo" inputMode="decimal" value={v.costo} error={campos.costo} ayuda="Opcional." onChange={(e) => set('costo', e.target.value)} />
                </>
              )}
            </div>
            {original?.costo != null && <p className="muted">Último costo: <strong className="num">{moneda(original.costo)}</strong></p>}
            <div className="pie-form">
              <button type="button" className="btn" onClick={onCerrar}>{bloqueado ? 'Cerrar' : 'Cancelar'}</button>
              {!bloqueado && <button type="submit" className="btn primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>}
            </div>
          </form>
          {original && (
            <section style={{ marginTop: 22 }}>
              <h3>Precios por lista</h3>
              {original.precios.length === 0 ? <p className="muted">Todavía no tiene precios cargados.</p> : (
                <div className="tabla-caja" style={{ marginTop: 8 }}>
                  <table><thead><tr><th>Lista</th><th>Rige desde</th><th className="num">Precio neto</th></tr></thead>
                    <tbody>{original.precios.map((p) => <tr key={`${p.lista_id}-${p.vigente_desde}`}><td>{p.lista}</td><td>{fecha(p.vigente_desde)}</td><td className="num">{moneda(p.precio_neto)}</td></tr>)}</tbody></table>
                </div>
              )}
              {!bloqueado && (
                <div style={{ marginTop: 12 }}>
                  {generalPrecio && <Alerta>{generalPrecio}</Alerta>}
                  <div className="rejilla">
                    <Selector etiqueta="Lista" value={nuevo.lista_id} error={camposPrecio.lista_id} onChange={(e) => setNuevo({ ...nuevo, lista_id: e.target.value })}>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Selector>
                    <Campo etiqueta="Nuevo precio neto" inputMode="decimal" value={nuevo.precio} error={camposPrecio.precio_neto} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
                    <Campo etiqueta="Rige desde" type="date" value={nuevo.desde} error={camposPrecio.vigente_desde} onChange={(e) => setNuevo({ ...nuevo, desde: e.target.value })} />
                  </div>
                  <div className="pie-form"><button type="button" className="btn" disabled={!nuevo.precio.trim()} onClick={cambiarPrecio}>Guardar precio</button></div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
