import {
  NOMBRE_TIPO,
  type Clasificacion,
  type Destino,
  type MetodoClasificacion,
} from '../lib/clasificarHojas'
import { EtiquetaValidacion } from './ReporteExtraccion'

interface Props {
  clasificacion: Clasificacion
  onDestino: (hoja: string, destino: Destino) => void
  onPeriodos: (anioActual: number | null, anioAnterior: number | null) => void
  onRestablecer: () => void
  consultandoIA: boolean
  errorIA: string | null
  avisosIA: string[]
  onPedirIA: () => void
}

const METODO: Record<MetodoClasificacion, string> = {
  automatico: 'clasificadas por su contenido',
  ia: 'clasificadas con ayuda de la IA',
  manual: 'con ajustes manuales',
}

const DESTINO_CLASE: Record<Destino, string> = {
  actual: 'regla',
  anterior: 'regla',
  notas: 'memoria',
  ignorada: '',
  revision: 'pendiente',
}

export default function ClasificacionHojas({
  clasificacion: c,
  onDestino,
  onPeriodos,
  onRestablecer,
  consultandoIA,
  errorIA,
  avisosIA,
  onPedirIA,
}: Props) {
  const fallas = c.validaciones.filter((v) => v.bloqueante && !v.ok)
  const etiquetaDestino = (d: Destino): string =>
    d === 'actual'
      ? `Año actual${c.anioActual ? ` · ${c.anioActual}` : ''}`
      : d === 'anterior'
        ? `Año anterior${c.anioAnterior ? ` · ${c.anioAnterior}` : ''}`
        : d === 'notas'
          ? 'Notas'
          : d === 'ignorada'
            ? 'No se usa'
            : '⚠ Revisión requerida'
  const hayManuales = c.hojas.some((h) => h.manual)

  return (
    <div className="panel">
      <div className="fila" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>Clasificación de las hojas</h2>
        <span className="sutil-texto">
          {c.hojas.length} hojas · {METODO[c.metodo]}
        </span>
      </div>
      <p className="sutil-texto">
        Cada hoja se asigna a un solo destino según su contenido. Revisa que la clasificación sea
        correcta antes de continuar; puedes cambiar cualquier destino.
      </p>

      <div className="fila" style={{ marginBottom: 12 }}>
        <div className="campo">
          <label htmlFor="anio-actual">Período actual</label>
          <select
            id="anio-actual"
            value={c.anioActual ?? ''}
            onChange={(e) => {
              const a = e.target.value ? Number(e.target.value) : null
              const previo = a !== null && c.aniosDisponibles.includes(a - 1) ? a - 1 : null
              onPeriodos(a, previo)
            }}
          >
            {c.anioActual === null && <option value="">— sin identificar —</option>}
            {c.aniosDisponibles.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="anio-anterior">Período anterior</label>
          <select
            id="anio-anterior"
            value={c.anioAnterior ?? ''}
            onChange={(e) => onPeriodos(c.anioActual, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— sin identificar —</option>
            {c.aniosDisponibles
              .filter((a) => c.anioActual === null || a < c.anioActual)
              .map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
          </select>
        </div>
        <span className="sutil-texto" style={{ paddingBottom: 8 }}>
          Los períodos disponibles son los de los balances de comprobación del libro.
        </span>
      </div>

      <div className="scroll" style={{ maxHeight: 420 }}>
        <table>
          <thead>
            <tr>
              <th>Hoja</th>
              <th>Clasificación</th>
              <th className="num">Período</th>
              <th>Destino</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {c.hojas.map((h) => (
              <tr key={h.nombre} className={h.destino === 'revision' ? 'revisar' : ''}>
                <td>
                  <b>{h.nombre}</b>
                </td>
                <td className="sutil-texto">{NOMBRE_TIPO[h.tipo]}</td>
                <td className="num">{h.anios.length ? h.anios.join(', ') : '—'}</td>
                <td>
                  <select
                    value={h.destino}
                    onChange={(e) => onDestino(h.nombre, e.target.value as Destino)}
                    className={`destino ${DESTINO_CLASE[h.destino]}`}
                  >
                    {h.destino === 'revision' && <option value="revision">{etiquetaDestino('revision')}</option>}
                    {(['actual', 'anterior', 'notas', 'ignorada'] as Destino[]).map((d) => (
                      <option key={d} value={d}>
                        {etiquetaDestino(d)}
                      </option>
                    ))}
                  </select>
                  {h.manual && <span className="etiqueta manual" style={{ marginLeft: 6 }}>manual</span>}
                </td>
                <td className="sutil-texto">{h.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fallas.length > 0 ? (
        <div className="aviso error" style={{ marginTop: 12 }}>
          <b>Revisión requerida antes de continuar.</b>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {fallas.map((v) => (
                <tr key={v.codigo}>
                  <td style={{ width: 70, border: 'none' }}>
                    <EtiquetaValidacion v={v} />
                  </td>
                  <td style={{ border: 'none' }}>
                    <b>{v.titulo}.</b> {v.detalle}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.metodo !== 'ia' && (
            <div style={{ marginTop: 8 }}>
              <button onClick={onPedirIA} disabled={consultandoIA}>
                {consultandoIA ? 'Consultando a la IA…' : 'Pedir a la IA que clasifique las hojas'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="aviso ok" style={{ marginTop: 12 }}>
          Clasificación completa: año actual {c.anioActual}, año anterior {c.anioAnterior}, y{' '}
          {c.hojas.filter((h) => h.destino === 'notas').length} hoja(s) de notas.
        </div>
      )}
      {c.razon && <div className="aviso info">IA: {c.razon}</div>}
      {[...c.avisos, ...avisosIA].map((a) => (
        <div className="aviso alerta" key={a}>
          {a}
        </div>
      ))}
      {errorIA && <div className="aviso alerta">{errorIA}</div>}
      {hayManuales && (
        <button className="sutil" onClick={onRestablecer}>
          Volver a la clasificación automática
        </button>
      )}
    </div>
  )
}
