import { useState } from 'react';
import { useSesion } from '../sesion';
import { cuitConGuiones, nombreCondicion } from '../formato';
import { Alerta, Etiqueta } from '../ui';

export function ElegirEmpresa() {
  const { yo, elegirEmpresa, salir } = useSesion();
  const [error, setError] = useState<string | null>(null);
  if (!yo) return null;
  return (
    <div className="ingreso">
      <div className="caja tarjeta">
        <div className="logo" aria-hidden="true">a</div>
        <h1>Hola, {yo.usuario.nombre.split(' ')[0]}</h1>
        <p className="muted">¿Con qué empresa vas a trabajar?</p>
        {error && <Alerta>{error}</Alerta>}
        {yo.empresas.length === 0 && <Alerta tipo="aviso">Todavía no tenés empresas asignadas. Pedile acceso al administrador del estudio.</Alerta>}
        <div className="eleccion">
          {yo.empresas.map((e) => (
            <button key={e.id} onClick={() => elegirEmpresa(e.id).catch((x: Error) => setError(x.message))}>
              <span><strong>{e.razon_social}</strong><small>CUIT {cuitConGuiones(e.cuit)} · {nombreCondicion(e.condicion_iva_codigo)}</small></span>
              <Etiqueta tono="info">{e.rol}</Etiqueta>
            </button>
          ))}
        </div>
        <div className="pie-form">{yo.admin_estudio && <a className="btn" href="#/estudio">Administrar el estudio</a>}<button className="btn" onClick={() => void salir()}>Salir</button></div>
      </div>
    </div>
  );
}
