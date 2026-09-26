import { useEffect, useMemo, useState } from 'react'
import { normalizar } from '../lib/excel'
import { NIVELES, type NivelFila } from '../lib/parseBalance'
import type { ExtraccionPeriodo } from '../lib/procesarLibro'
import type { Nivel } from '../lib/types'

/** Una fila de un solo período, tal como viene en su hoja. */
interface FilaExplorador {
  clave: string
  codigo: string
  nombre: string
  nivel: NivelFila
  nit: string | null
  esHoja: boolean
  saldo: number | null
  saldoInicial: number | null
  ultimoMovimiento: string | null
  celda: string
}

interface Props {
  periodo: ExtraccionPeriodo
}

function filasDelPeriodo(p: ExtraccionPeriodo): FilaExplorador[] {
  const filas = p.union.filas
  const codigos = [...new Set(filas.filter((f) => f.nivel !== 'tercero').map((f) => f.codigo))].sort()
  const conHijas = new Set(
    codigos.filter((c, i) => codigos[i + 1]?.startsWith(c)),
  )
  return filas.map((f) => ({
    clave: f.clave,
    codigo: f.codigo,
    nombre: f.nombre,
    nivel: f.nivel,
    nit: f.nit,
    esHoja: f.nivel !== 'tercero' && !conHijas.has(f.codigo),
    saldo: f.saldo,
    saldoInicial: f.saldoInicial,
    ultimoMovimiento: f.ultimoMovimiento,
    celda: `${f.hoja}!${f.celdaSaldo}`,
  }))
}

/** Encabezados tal como vienen en la (primera) hoja del período; null = no trae esa columna. */
function columnasDe(p: ExtraccionPeriodo) {
  const { mapeo, encabezados } = p.hojas[0]
  const titulo = (c: number | null) => (c === null ? null : encabezados[c] || null)
  return {
    ultMov: titulo(mapeo.colUltMov),
    saldoInicial: titulo(mapeo.colSaldoInicial),
    saldo: titulo(mapeo.colSaldo) ?? 'Saldo',
  }
}

const PAGINA = 200

const fmt = (n: number | null): string =>
  n === null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)

const PROFUNDIDAD: Record<string, number> = {
  grupo: 0,
  cuenta: 1,
  subcuenta: 2,
  auxiliar: 3,
  subauxiliar: 4,
  tercero: 5,
}

export default function ExploradorCuentas({ periodo }: Props) {
  const cuentas = useMemo(() => filasDelPeriodo(periodo), [periodo])
  const columnas = useMemo(() => columnasDe(periodo), [periodo])
  const [seleccion, setSeleccion] = useState<Partial<Record<Nivel, string>>>({})
  const [busqueda, setBusqueda] = useState('')
  const [verTerceros, setVerTerceros] = useState(false)
  const [limite, setLimite] = useState(PAGINA)

  const deCuenta = useMemo(() => cuentas.filter((c) => c.nivel !== 'tercero'), [cuentas])

  // Si la extracción cambia (otra columna, otra hoja), la selección puede no existir ya.
  useEffect(() => {
    const codigos = new Set(deCuenta.map((c) => c.codigo))
    setSeleccion((s) => {
      const limpia: Partial<Record<Nivel, string>> = {}
      for (const n of NIVELES) {
        if (s[n] && codigos.has(s[n]!)) limpia[n] = s[n]
        else break
      }
      return limpia
    })
    setLimite(PAGINA)
  }, [deCuenta])

  /** Código más profundo seleccionado hasta (sin incluir) el nivel dado. */
  const prefijoHasta = (nivel: Nivel): string => {
    let p = ''
    for (const n of NIVELES) {
      if (n === nivel) break
      if (seleccion[n]) p = seleccion[n]!
    }
    return p
  }

  const opcionesDe = (nivel: Nivel): FilaExplorador[] => {
    const p = prefijoHasta(nivel)
    return deCuenta.filter((c) => c.nivel === nivel && c.codigo.startsWith(p))
  }

  function elegir(nivel: Nivel, codigo: string) {
    const siguiente: Partial<Record<Nivel, string>> = {}
    for (const n of NIVELES) {
      if (n === nivel) {
        if (codigo) siguiente[n] = codigo
        break
      }
      if (seleccion[n]) siguiente[n] = seleccion[n]
    }
    setSeleccion(siguiente)
    setLimite(PAGINA)
  }

  const seleccionado = [...NIVELES].reverse().map((n) => seleccion[n]).find(Boolean) ?? ''

  const filas = useMemo(() => {
    const q = normalizar(busqueda)
    return cuentas.filter((c) => {
      if (c.nivel === 'tercero' && !verTerceros) return false
      if (seleccionado && !c.codigo.startsWith(seleccionado)) return false
      if (q && !normalizar(`${c.codigo} ${c.nombre} ${c.nit ?? ''}`).includes(q)) return false
      return true
    })
  }, [cuentas, seleccionado, busqueda, verTerceros])

  const porNivel = NIVELES.map((n) => [n, deCuenta.filter((c) => c.nivel === n).length] as const)
  const terceros = cuentas.length - deCuenta.length
  const hojasCalculo = deCuenta.filter((c) => c.esHoja).length

  return (
    <>
      <div className="metricas">
        {porNivel.map(([n, k]) => (
          <div className="metrica" key={n}>
            <b>{k}</b>
            <span>{n}</span>
          </div>
        ))}
        <div className="metrica">
          <b>{terceros}</b>
          <span>terceros (NIT)</span>
        </div>
        <div className="metrica">
          <b>{hojasCalculo}</b>
          <span>cuentas al nivel más profundo</span>
        </div>
      </div>

      <h3>Explorar cuentas</h3>
      <div className="fila" style={{ marginBottom: 10 }}>
        {NIVELES.map((n) => {
          const opciones = opcionesDe(n)
          return (
            <div className="campo" key={n}>
              <label>{n}</label>
              <select
                value={seleccion[n] ?? ''}
                onChange={(e) => elegir(n, e.target.value)}
                disabled={opciones.length === 0}
                style={{ maxWidth: 220 }}
              >
                <option value="">{opciones.length ? `— todos (${opciones.length}) —` : '— no hay —'}</option>
                {opciones.map((c) => (
                  <option key={c.clave} value={c.codigo}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
        <div className="campo">
          <label>nombre, código o NIT</label>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar…" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 7 }}>
          <input
            type="checkbox"
            checked={verTerceros}
            onChange={(e) => setVerTerceros(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Mostrar terceros
        </label>
      </div>

      <p className="sutil-texto" style={{ margin: '0 0 6px' }}>
        Columnas de {periodo.hojas.length > 1 ? 'las hojas' : 'la hoja'} «{periodo.union.hoja}» ({periodo.anio}), tal como vienen en el archivo.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Nivel</th>
              {columnas.ultMov && <th>{columnas.ultMov}</th>}
              {columnas.saldoInicial && <th className="num">{columnas.saldoInicial}</th>}
              <th className="num">{columnas.saldo}</th>
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, limite).map((c) => (
              <tr key={c.clave} className={c.codigo === seleccionado && c.nivel !== 'tercero' ? 'subtotal' : ''}>
                <td>{c.nivel === 'tercero' ? '' : c.codigo}</td>
                <td style={{ paddingLeft: 10 + PROFUNDIDAD[c.nivel] * 12 }}>
                  {c.nombre}
                  {c.nit && <span className="sutil-texto"> · NIT {c.nit}</span>}
                </td>
                <td className="sutil-texto">{c.nivel}</td>
                {columnas.ultMov && <td className="sutil-texto">{c.ultimoMovimiento ?? '—'}</td>}
                {columnas.saldoInicial && <td className="num">{fmt(c.saldoInicial)}</td>}
                <td className="num">{fmt(c.saldo)}</td>
                <td className="sutil-texto">{c.celda}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <span className="sutil-texto">
          {filas.length === 0
            ? 'Ninguna cuenta coincide con la selección.'
            : `Mostrando ${Math.min(limite, filas.length)} de ${filas.length}. — = celda sin valor en el archivo.`}
        </span>
        {filas.length > limite && <button onClick={() => setLimite((l) => l + PAGINA)}>Mostrar {PAGINA} más</button>}
      </div>
    </>
  )
}
