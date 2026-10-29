// Trazabilidad: quién hizo qué, sobre qué empresa y cuándo. Libro de solo lectura (solo se agrega, y cada evento está encadenado al anterior
// con una huella SHA-256). Solo para administradores del estudio. Exportar y verificar la cadena también quedan registrados.
import { useEffect, useState } from 'react';
import { descargar, enviar, ErrorApi, obtener } from '../api';
import { fechaHora } from '../formato';
import type { EmpresaAdmin, EventoDetalle, EventoTraza, Pagina, Persona, VerificacionCadena } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
const CATEGORIAS: Record<string, string> = { acceso: 'Acceso', comprobantes: 'Comprobantes', contabilidad: 'Contabilidad', tesoreria: 'Tesorería', stock: 'Stock', maestros: 'Maestros', seguridad: 'Seguridad', asistente: 'Asistente' };
const RESULTADOS: Record<string, { texto: string; tono: 'ok' | 'aviso' | 'malo' }> = { ok: { texto: 'Correcto', tono: 'ok' }, rechazo: { texto: 'Rechazado', tono: 'aviso' }, fallo: { texto: 'Falló', tono: 'malo' } };

type Filtros = { q: string; categoria: string; resultado: string; empresa_id: string; usuario_id: string; desde: string; hasta: string; entidad_tabla: string; entidad_id: string };
const SIN_FILTROS: Filtros = { q: '', categoria: '', resultado: '', empresa_id: '', usuario_id: '', desde: '', hasta: '', entidad_tabla: '', entidad_id: '' };

export function Trazabilidad() {
  const avisar = useAviso();
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<EventoTraza> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaAdmin[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const q = useRetraso(f.q);
  const filtros = { ...f, q };

  useEffect(() => {
    obtener<{ datos: EmpresaAdmin[] }>('/api/estudio/empresas').then((r) => setEmpresas(r.datos)).catch(() => setEmpresas([]));
    obtener<{ datos: Persona[] }>('/api/estudio/personas').then((r) => setPersonas(r.datos)).catch(() => setPersonas([]));
  }, []);
  const clave = JSON.stringify(filtros);
  useEffect(() => { setPagina(0); }, [clave]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<EventoTraza>>('/api/estudio/trazabilidad', { ...filtros, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, pagina]);

  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setF((a) => ({ ...a, [k]: v }));
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const hayFiltros = JSON.stringify(f) !== JSON.stringify(SIN_FILTROS);

  async function exportar() {
    setExportando(true);
    try { await descargar('/api/estudio/trazabilidad/exportar', filtros, 'trazabilidad.csv'); avisar('Se descargó el CSV con lo que estás viendo.'); } catch (e) { avisar((e as Error).message, 'error'); } finally { setExportando(false); }
  }

  return (
    <>
      <div className="cabecera">
        <div><h1>Trazabilidad</h1><p>Quién hizo qué, sobre qué empresa y cuándo. Solo se agrega: nada se edita ni se borra.</p></div>
        <div className="acciones"><button className="btn" onClick={exportar} disabled={exportando || !datos || total === 0}>{exportando ? 'Preparando…' : 'Exportar CSV'}</button><button className="btn primario" onClick={() => setVerificando(true)}>Verificar integridad</button></div>
      </div>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Actividad, detalle, persona o TR-000123" />
        <Selector etiqueta="Tipo" value={f.categoria} onChange={(e) => set('categoria', e.target.value)}><option value="">Todos</option>{Object.entries(CATEGORIAS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
        <Selector etiqueta="Resultado" value={f.resultado} onChange={(e) => set('resultado', e.target.value)}><option value="">Todos</option>{Object.entries(RESULTADOS).map(([k, r]) => <option key={k} value={k}>{r.texto}</option>)}</Selector>
        <Selector etiqueta="Empresa" value={f.empresa_id} onChange={(e) => set('empresa_id', e.target.value)}><option value="">Todas</option><option value="sin">Del estudio (sin empresa)</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.razon_social}</option>)}</Selector>
        <Selector etiqueta="Persona" value={f.usuario_id} onChange={(e) => set('usuario_id', e.target.value)}><option value="">Todas</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
        <Campo etiqueta="Desde" type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} /><Campo etiqueta="Hasta" type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} />
      </div>
      {f.entidad_tabla && <p style={{ margin: '0 0 10px' }}><Etiqueta tono="info">Registro: {f.entidad_tabla} n.º {f.entidad_id}</Etiqueta> <button className="btn chico" onClick={() => setF((a) => ({ ...a, entidad_tabla: '', entidad_id: '' }))}>Quitar</button></p>}
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo={hayFiltros ? 'No hay eventos con esos filtros' : 'Todavía no hay eventos'}>{hayFiltros && <button className="btn chico" onClick={() => setF(SIN_FILTROS)}>Quitar los filtros</button>}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>ID</th><th>Fecha y hora</th><th>Persona</th><th>Empresa</th><th>Actividad</th><th>Resultado</th></tr></thead>
            <tbody>
              {datos.datos.map((e) => (
                <tr key={e.nro} className="clic" onClick={() => setAbierto(e.nro)}>
                  <td className="num" style={{ textAlign: 'left' }}>{e.codigo}</td><td style={{ whiteSpace: 'nowrap' }}>{fechaHora(e.en)}</td><td>{e.usuario ?? <span className="muted">—</span>}</td>
                  <td>{e.empresa ?? <span className="muted">Estudio</span>}</td>
                  <td><strong>{e.accion}</strong>{e.detalle && <div className="muted">{e.detalle}</div>}<div className="muted" style={{ fontSize: 12 }}>{CATEGORIAS[e.categoria] ?? e.categoria}</div></td>
                  <td><Etiqueta tono={RESULTADOS[e.resultado]?.tono ?? 'neutro'}>{RESULTADOS[e.resultado]?.texto ?? e.resultado}</Etiqueta></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>{total} eventos · página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Más nuevos</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Más viejos</button></span></div>}
      {abierto !== null && <Detalle nro={abierto} onCerrar={() => setAbierto(null)} onVerRegistro={(t, id) => { setF((a) => ({ ...a, entidad_tabla: t, entidad_id: String(id) })); setAbierto(null); }} />}
      {verificando && <Verificacion onCerrar={() => setVerificando(false)} onVerEvento={(n) => { setVerificando(false); setAbierto(n); }} />}
    </>
  );
}

function Detalle({ nro, onCerrar, onVerRegistro }: { nro: number; onCerrar: () => void; onVerRegistro: (tabla: string, id: number) => void }) {
  const [e, setE] = useState<EventoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { obtener<EventoDetalle>(`/api/estudio/trazabilidad/${nro}`).then(setE).catch((x) => setError(x.message)); }, [nro]);
  return (
    <Modal titulo={e ? `${e.codigo} · ${e.accion}` : 'Evento'} onCerrar={onCerrar} ancho={680}>
      {error && <Alerta>{error}</Alerta>}
      {!e && !error && <Cargando />}
      {e && (
        <>
          {(!e.huella_ok || !e.enlace_ok) && <Alerta>Este evento <strong>no pasa la verificación</strong>: {!e.huella_ok ? 'su contenido no coincide con su huella (fue modificado)' : 'no enlaza con el evento anterior (se quitó o se intercaló algo)'}.</Alerta>}
          <dl className="ficha">
            <dt>Cuándo</dt><dd>{fechaHora(e.en, true)}</dd>
            <dt>Persona</dt><dd>{e.usuario ?? '—'}</dd>
            <dt>Empresa</dt><dd>{e.empresa ?? 'Del estudio (sin empresa)'}</dd>
            <dt>Tipo</dt><dd>{CATEGORIAS[e.categoria] ?? e.categoria}</dd>
            <dt>Resultado</dt><dd><Etiqueta tono={RESULTADOS[e.resultado]?.tono ?? 'neutro'}>{RESULTADOS[e.resultado]?.texto ?? e.resultado}</Etiqueta></dd>
            {e.detalle && <><dt>Detalle</dt><dd>{e.detalle}</dd></>}
            <dt>Origen</dt><dd>{e.ip ?? '—'}{e.dispositivo && <div className="muted">{e.dispositivo}</div>}</dd>
          </dl>
          {e.cambios && e.cambios.length > 0 && (
            <div className="tabla-caja" style={{ margin: '12px 0' }}>
              <table><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
                <tbody>{e.cambios.map((c) => <tr key={c.campo}><td><strong>{c.campo}</strong></td><td>{c.antes ?? <span className="muted">—</span>}</td><td>{c.despues ?? <span className="muted">—</span>}</td></tr>)}</tbody></table>
            </div>
          )}
          <h3 style={{ margin: '14px 0 6px' }}>Integridad</h3>
          <p style={{ margin: '0 0 6px' }}><Etiqueta tono={e.huella_ok ? 'ok' : 'malo'}>{e.huella_ok ? 'La huella coincide con el contenido' : 'La huella NO coincide'}</Etiqueta> <Etiqueta tono={e.enlace_ok ? 'ok' : 'malo'}>{e.enlace_ok ? 'Enlaza con el evento anterior' : 'No enlaza con el anterior'}</Etiqueta></p>
          <p className="huella">Huella <code>{e.huella}</code></p><p className="huella">Anterior <code>{e.huella_prev || '(primer evento)'}</code></p>
          <div className="pie-form">{e.entidad_tabla && e.entidad_id != null && <button className="btn" style={{ marginRight: 'auto' }} onClick={() => onVerRegistro(e.entidad_tabla!, e.entidad_id!)}>Ver todo sobre este registro</button>}<button className="btn" onClick={onCerrar}>Cerrar</button></div>
        </>
      )}
    </Modal>
  );
}

function Verificacion({ onCerrar, onVerEvento }: { onCerrar: () => void; onVerEvento: (nro: number) => void }) {
  const avisar = useAviso();
  const [r, setR] = useState<VerificacionCadena | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [nro, setNro] = useState('');
  const [huella, setHuella] = useState('');
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function verificar(contraGuardada: boolean) {
    setTrabajando(true); setError(null);
    try { setR(await enviar<VerificacionCadena>('POST', '/api/estudio/trazabilidad/verificar', contraGuardada ? { nro: nro.trim(), huella: huella.trim() } : {})); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  useEffect(() => { void verificar(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const copiar = (t: string) => { navigator.clipboard?.writeText(t).then(() => avisar('Copiado.')).catch(() => avisar('No se pudo copiar: seleccionalo y copialo a mano.', 'error')); };
  const general = resumenErrores(error, ['nro', 'huella']);
  return (
    <Modal titulo="Verificar la integridad" onCerrar={onCerrar} ancho={680}>
      {general && <Alerta>{general}</Alerta>}
      {!r && !error && <Cargando texto="Recorriendo la cadena…" />}
      {r && (
        <>
          {r.integra
            ? <Alerta tipo="info">La cadena está <strong>íntegra</strong>: {r.eventos} eventos, ninguno modificado ni intercalado.</Alerta>
            : <Alerta>{r.primer_evento_roto ? <>La cadena <strong>se rompe en el evento {r.primer_evento_roto}</strong>: fue modificado, quitado o intercalado. <button className="btn chico" onClick={() => onVerEvento(r.primer_evento_roto!)}>Verlo</button></> : <>La cadena es coherente por dentro, pero <strong>no coincide con la cabeza que guardaste</strong>.</>}</Alerta>}
          {r.resguardo && <Alerta tipo={r.resguardo.coincide ? 'info' : 'error'}>{r.resguardo.motivo}</Alerta>}
          <h3 style={{ margin: '12px 0 6px' }}>Cabeza de la cadena</h3>
          <p className="muted" style={{ margin: '0 0 6px' }}>Es el último evento. <strong>Guardala fuera del sistema</strong> (un documento tuyo, un correo): es lo único que permite notar que alguien <em>quitó</em> los últimos eventos.</p>
          {r.cabeza && <><p className="huella">Evento <code>{r.cabeza.nro}</code> <button className="btn chico" onClick={() => copiar(String(r.cabeza!.nro))}>Copiar</button></p><p className="huella">Huella <code>{r.cabeza.huella}</code> <button className="btn chico" onClick={() => copiar(r.cabeza!.huella)}>Copiar</button></p></>}
          <h3 style={{ margin: '16px 0 6px' }}>Comparar con una cabeza guardada</h3>
          <div className="rejilla">
            <Campo etiqueta="Número de evento" inputMode="numeric" value={nro} error={campos.nro} onChange={(e) => setNro(e.target.value)} />
            <Campo etiqueta="Huella guardada" value={huella} error={campos.huella} onChange={(e) => setHuella(e.target.value)} />
          </div>
          <div className="pie-form"><button className="btn" onClick={() => verificar(false)} disabled={trabajando}>Volver a verificar</button><button className="btn primario" onClick={() => verificar(true)} disabled={trabajando || !nro.trim() || !huella.trim()}>Comparar con lo guardado</button><button className="btn" onClick={onCerrar}>Cerrar</button></div>
        </>
      )}
      {!r && error != null && <div className="pie-form"><button className="btn" onClick={onCerrar}>Cerrar</button></div>}
    </Modal>
  );
}

