/**
 * Salida en Excel (RF-023). El PDF se obtiene imprimiendo la vista de estados
 * desde el navegador, que es el mismo "Guardar como PDF" que usa hoy la oficina.
 */
import * as XLSX from 'xlsx'
import type { Informe, LineaEstado, Nota } from './types'

type Fila = (string | number | null)[]

function encabezado(informe: Informe, titulo: string): Fila[] {
  return [
    [titulo],
    [informe.nombre_archivo],
    [
      `Periodo ${informe.periodo_actual}` +
        (informe.periodo_anterior ? ` — comparativo ${informe.periodo_anterior}` : ''),
    ],
    [],
  ]
}

function hojaEstado(informe: Informe, titulo: string, lineas: LineaEstado[]): XLSX.WorkSheet {
  const filas: Fila[] = encabezado(informe, titulo)
  filas.push([
    'Concepto',
    'Nota',
    String(informe.periodo_actual),
    informe.periodo_anterior ? String(informe.periodo_anterior) : '',
  ])
  for (const l of lineas) {
    filas.push([
      l.tipo === 'rubro' ? `  ${l.etiqueta}` : l.etiqueta,
      l.nota ?? '',
      Number.isNaN(l.actual) ? '' : l.actual,
      l.anterior ?? '',
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(filas)
  ws['!cols'] = [{ wch: 48 }, { wch: 6 }, { wch: 18 }, { wch: 18 }]
  return ws
}

function hojaNotas(informe: Informe, notas: Nota[]): XLSX.WorkSheet {
  const filas: Fila[] = encabezado(informe, 'Notas a los estados financieros')
  for (const n of notas) {
    filas.push([`Nota ${n.numero} — ${n.titulo}`])
    filas.push([
      'Código',
      'Cuenta',
      String(informe.periodo_actual),
      informe.periodo_anterior ? String(informe.periodo_anterior) : '',
    ])
    for (const d of n.detalle) {
      filas.push([d.codigo, d.nombre, d.actual, d.anterior ?? ''])
    }
    filas.push(['', 'Total', n.totalActual, n.totalAnterior ?? ''])
    filas.push([])
  }
  const ws = XLSX.utils.aoa_to_sheet(filas)
  ws['!cols'] = [{ wch: 16 }, { wch: 48 }, { wch: 18 }, { wch: 18 }]
  return ws
}

export function exportarLibro(
  informe: Informe,
  notas: Nota[],
  esf: LineaEstado[],
  er: LineaEstado[],
): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, hojaEstado(informe, 'Estado de situación financiera', esf),
    `Balance ${informe.periodo_actual}`)
  XLSX.utils.book_append_sheet(wb, hojaEstado(informe, 'Estado de resultados', er),
    'Estado de resultados')
  XLSX.utils.book_append_sheet(wb, hojaNotas(informe, notas), 'Notas')
  XLSX.writeFile(wb, `Estados financieros ${informe.periodo_actual}.xlsx`)
}

export const exportarPDF = (): void => window.print()
