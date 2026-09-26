import { useState } from 'react'
import { normalizar } from '../lib/excel'
import type { NotasDelLibro } from '../lib/parseNotas'

interface Props {
  notas: NotasDelLibro
  anioActual: number
  anioAnterior: number
}

const fmt = (n: number | null): string =>
  n === null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)

export default function NotasArchivo({ notas, anioActual, anioAnterior }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const q = normalizar(busqueda)
  const visibles = notas.notas.filter(
    (n) =>
      !q ||
      normalizar(`${n.numero ?? ''} ${n.titulo}`).includes(q) ||
      n.lineas.some((l) => normalizar(l.etiqueta ?? '').includes(q)),
  )

  return (
    <>
      <div className="fila" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <span className="sutil-texto">
          {notas.notas.length} notas, tal como vienen en el archivo.{' '}
          {notas.porHoja
            .map(
              (h) =>
                `«${h.hoja}»: ${h.notas} nota(s), ${anioActual} en ${h.columnasAnios[anioActual] ?? '?'} y ` +
                `${anioAnterior} en ${h.columnasAnios[anioAnterior] ?? '?'}`,
            )
            .join(' · ')}
        </span>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en las notas…" />
      </div>

      {visibles.map((n) => (
        <div className="nota" key={n.orden}>
          {n.seccion && <div className="sutil-texto seccion-nota">{n.seccion}</div>}
          <h3>
            {n.numero ? `Nota ${n.numero}` : 'Nota sin número'} — {n.titulo}
            <span className="sutil-texto" style={{ fontWeight: 400 }}>
              {' '}
              · {notas.hojas.length > 1 ? `«${n.hoja}», ` : ''}filas {n.filaInicio}–{n.filaFin}
            </span>
          </h3>
          {n.lineas.length === 0 ? (
            <p className="sutil-texto">La nota no tiene líneas.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th className="num">{anioActual}</th>
                  <th className="num">{anioAnterior}</th>
                  <th className="num">Fila</th>
                </tr>
              </thead>
              <tbody>
                {n.lineas.map((l) => (
                  <tr
                    key={l.orden}
                    className={l.tipo === 'total' ? 'total' : l.tipo === 'subtotal' ? 'subtotal' : ''}
                  >
                    <td
                      style={{
                        paddingLeft: 10 + l.sangria * 16,
                        fontStyle: l.tipo === 'encabezado' ? 'italic' : undefined,
                      }}
                    >
                      {l.etiqueta ?? <span className="sutil-texto">(sin descripción)</span>}
                    </td>
                    <td className="num">{l.tipo === 'encabezado' || l.tipo === 'texto' ? '' : fmt(l.actual)}</td>
                    <td className="num">{l.tipo === 'encabezado' || l.tipo === 'texto' ? '' : fmt(l.anterior)}</td>
                    <td className="num sutil-texto">{l.fila}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {visibles.length === 0 && <p className="sutil-texto">Ninguna nota coincide con la búsqueda.</p>}
    </>
  )
}
