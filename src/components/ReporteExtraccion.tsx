import type { Descarte } from '../lib/parseBalance'
import type { ResultadoValidacion } from '../lib/types'

interface Props {
  validaciones: ResultadoValidacion[]
  descartes: Descarte[]
}

export function EtiquetaValidacion({ v }: { v: ResultadoValidacion }) {
  const estilo = v.ok
    ? { background: 'var(--ok-suave)', borderColor: '#bfe3ce', color: 'var(--ok)' }
    : v.bloqueante
      ? { background: 'var(--error-suave)', borderColor: '#f3c6c3', color: 'var(--error)' }
      : { background: 'var(--alerta-suave)', borderColor: '#eedba6', color: 'var(--alerta)' }
  return (
    <span className="etiqueta" style={estilo}>
      {v.ok ? 'ok' : v.bloqueante ? 'bloquea' : 'revisar'}
    </span>
  )
}

export default function ReporteExtraccion({ validaciones, descartes }: Props) {
  return (
    <>
      <table style={{ marginBottom: 16 }}>
        <tbody>
          {validaciones.map((v) => (
            <tr key={v.codigo}>
              <td style={{ width: 70 }}>
                <EtiquetaValidacion v={v} />
              </td>
              <td style={{ width: 50 }} className="sutil-texto">
                {v.codigo}
              </td>
              <td style={{ width: '32%' }}>{v.titulo}</td>
              <td className="sutil-texto">{v.detalle}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details open={descartes.length > 0 && descartes.length <= 20}>
        <summary>
          <b>Filas no incorporadas ({descartes.length})</b>
          <span className="sutil-texto"> — nada se descarta sin quedar registrado aquí</span>
        </summary>
        {descartes.length === 0 ? (
          <p className="sutil-texto">Ninguna.</p>
        ) : (
          <div className="scroll" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Hoja</th>
                  <th className="num">Fila</th>
                  <th>Motivo</th>
                  <th>Contenido</th>
                </tr>
              </thead>
              <tbody>
                {descartes.map((d, i) => (
                  <tr key={i}>
                    <td>{d.hoja}</td>
                    <td className="num">{d.fila}</td>
                    <td>{d.motivo}</td>
                    <td className="sutil-texto">{d.contenido}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </>
  )
}
