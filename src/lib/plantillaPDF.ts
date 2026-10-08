/**
 * Plantilla institucional en PDF (carta). pdfmake se carga solo al exportar.
 *
 * Portada → Estado de situación financiera → Estado de resultados → Notas.
 * Cada página lleva la empresa y el NIT en el encabezado y la paginación al pie.
 */
import type { Content, ContentTable, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces'
import {
  fechaHoy,
  firmantes,
  formatoNumero,
  formatoPorcentaje,
  nombreArchivo,
  textoCorte,
  textoPeriodoResultados,
  type DocumentoFinanciero,
  type FilaPresentacion,
} from './documento'
import { descargar } from './plantillaExcel'

const C = {
  marino: '#1F3864',
  acento: '#2E75B6',
  claro: '#DCE6F1',
  gris: '#F2F4F7',
  borde: '#BFC9D9',
  texto: '#1B2028',
  suave: '#667085',
}

const num = (n: number | null, extra: Record<string, unknown> = {}): TableCell => ({
  text: formatoNumero(n), alignment: 'right', ...extra,
})
const pct = (p: number | null, extra: Record<string, unknown> = {}): TableCell => ({
  text: formatoPorcentaje(p), alignment: 'right', fontSize: 7.5, color: C.suave, ...extra,
})

function bloqueTitulo(d: DocumentoFinanciero, titulo: string, subtitulo: string): Content {
  return {
    stack: [
      { text: d.encabezado.razonSocial || 'Razón social', style: 'empresa' },
      d.encabezado.nit ? { text: `NIT ${d.encabezado.nit}`, style: 'nit' } : '',
      { text: titulo.toUpperCase(), style: 'tituloEstado' },
      { text: subtitulo, style: 'subtitulo' },
      { text: d.encabezado.moneda, style: 'moneda' },
      { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 512, y2: 4, lineWidth: 1.2, lineColor: C.marino }] },
    ],
    margin: [0, 0, 0, 12],
  }
}

function cabecera(d: DocumentoFinanciero, primera: string): TableCell[] {
  const h = (text: string, alignment: 'left' | 'right' | 'center' = 'right'): TableCell => ({
    text, style: 'th', alignment, fillColor: C.marino,
  })
  return [
    h(primera, 'left'),
    h('Nota', 'center'),
    h(String(d.periodoActual)),
    h(d.periodoAnterior ? String(d.periodoAnterior) : ''),
    h('Variación'),
    h('%'),
  ]
}

function filaEstado(f: FilaPresentacion): TableCell[] {
  const base = (texto: string, estilo: Record<string, unknown>, sangria: number): TableCell[] => [
    { text: texto, margin: [sangria, 0, 0, 0], ...estilo },
    { text: f.nota ?? '', alignment: 'center', color: C.acento, fontSize: 7.5 },
    num(f.actual, estilo),
    num(f.anterior, estilo),
    num(f.variacion, { ...estilo, color: C.suave }),
    pct(f.porcentaje),
  ]
  switch (f.tipo) {
    case 'seccion':
      return [
        { text: f.etiqueta, bold: true, color: C.marino, fillColor: C.claro, colSpan: 6, margin: [2, 1, 0, 1] },
        '', '', '', '', '',
      ]
    case 'titulo':
      return [{ text: f.etiqueta, bold: true, margin: [4, 2, 0, 0], colSpan: 6 }, '', '', '', '', '']
    case 'rubro':
      return base(f.etiqueta, {}, 14)
    case 'subtotal':
      return base(f.etiqueta, { bold: true }, 4)
    case 'total':
      return base(f.etiqueta, { bold: true, color: C.marino }, 4).map((c) => ({ ...(c as object), fillColor: C.gris })) as TableCell[]
    case 'gran_total':
      return [
        { text: f.etiqueta.toUpperCase(), bold: true, color: 'white', fillColor: C.marino, margin: [4, 2, 0, 2] },
        { text: '', fillColor: C.marino },
        num(f.actual, { bold: true, color: 'white', fillColor: C.marino, margin: [0, 2, 0, 2] }),
        num(f.anterior, { bold: true, color: 'white', fillColor: C.marino, margin: [0, 2, 0, 2] }),
        num(f.variacion, { color: '#E3E9F3', fillColor: C.marino, margin: [0, 2, 0, 2] }),
        pct(f.porcentaje, { color: '#E3E9F3', fillColor: C.marino, margin: [0, 2, 0, 2] }),
      ]
    default:
      return [{ text: ' ', fontSize: 4, colSpan: 6 }, '', '', '', '', '']
  }
}

function tablaEstado(d: DocumentoFinanciero, filas: FilaPresentacion[]): ContentTable {
  return {
    table: {
      headerRows: 1,
      widths: ['*', 28, 70, 70, 64, 36],
      body: [cabecera(d, 'Concepto'), ...filas.map(filaEstado)],
    },
    layout: {
      // La línea i va encima de la fila i; la fila k del cuerpo es filas[k - 1].
      hLineWidth: (i) => (filas[i - 1]?.tipo === 'subtotal' ? 0.5 : 0),
      vLineWidth: () => 0,
      hLineColor: () => C.borde,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
  }
}

function bloqueFirmas(d: DocumentoFinanciero): Content {
  const fs = firmantes(d.encabezado)
  return {
    unbreakable: true,
    margin: [0, 46, 0, 0],
    columns: fs.map((f) => ({
      width: '*',
      stack: [
        { canvas: [{ type: 'line', x1: 10, y1: 0, x2: 150, y2: 0, lineWidth: 0.7, lineColor: C.texto }] },
        { text: f.nombre || ' ', bold: true, fontSize: 8.5, margin: [0, 4, 0, 0], alignment: 'center' },
        { text: f.cargo, fontSize: 7.5, color: C.suave, alignment: 'center' },
        f.detalle ? { text: f.detalle, fontSize: 7.5, color: C.suave, alignment: 'center' } : '',
      ],
    })),
    columnGap: 12,
  }
}

function portada(d: DocumentoFinanciero): Content[] {
  return [
    { text: '', margin: [0, 130, 0, 0] },
    { text: d.encabezado.razonSocial || 'Razón social', style: 'portadaEmpresa' },
    d.encabezado.nit ? { text: `NIT ${d.encabezado.nit}`, style: 'portadaNit' } : '',
    d.encabezado.ciudad ? { text: d.encabezado.ciudad, style: 'portadaNit' } : '',
    { canvas: [{ type: 'line', x1: 156, y1: 18, x2: 356, y2: 18, lineWidth: 1.5, lineColor: C.acento }], margin: [0, 0, 0, 28] },
    { text: 'ESTADOS FINANCIEROS', style: 'portadaTitulo' },
    { text: textoCorte(d), style: 'portadaCorte' },
    { text: d.encabezado.moneda, style: 'portadaMoneda' },
    {
      margin: [130, 60, 130, 0],
      table: {
        widths: [18, '*', 30],
        body: [
          [{ text: 'Contenido', colSpan: 3, bold: true, color: C.marino, margin: [0, 0, 0, 4] }, '', ''],
          ...[
            ['Estado de situación financiera', 'esf'],
            ['Estado de resultados', 'er'],
            [`Notas a los estados financieros`, 'notas'],
          ].map(([t, id], i) => [
            { text: `${i + 1}.`, color: C.acento },
            { text: t, linkToDestination: id },
            { pageReference: id, alignment: 'right', color: C.suave } as TableCell,
          ]),
        ],
      },
      layout: {
        hLineWidth: (i: number) => (i === 1 ? 0.6 : 0),
        vLineWidth: () => 0,
        hLineColor: () => C.borde,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
    },
    {
      absolutePosition: { x: 50, y: 700 },
      stack: [
        {
          text: d.aprobadoAt ? `Informe aprobado el ${fechaHoy(new Date(d.aprobadoAt))}` : 'Borrador — informe no aprobado',
          alignment: 'center', fontSize: 8, color: d.aprobadoAt ? C.suave : '#B3261E',
        },
        { text: `Generado el ${fechaHoy(d.generadoAt)}`, alignment: 'center', fontSize: 8, color: C.suave },
      ],
    },
  ]
}

function notas(d: DocumentoFinanciero): Content[] {
  const out: Content[] = [bloqueTitulo(d, 'Notas a los estados financieros', textoCorte(d))]
  if (d.notas.length === 0) out.push({ text: 'No hay notas con saldo para presentar.', color: C.suave })
  for (const n of d.notas) {
    const body: TableCell[][] = [
      [
        { text: 'Código', style: 'thNota' }, { text: 'Cuenta', style: 'thNota' },
        { text: String(d.periodoActual), style: 'thNota', alignment: 'right' },
        { text: d.periodoAnterior ? String(d.periodoAnterior) : '', style: 'thNota', alignment: 'right' },
        { text: 'Variación', style: 'thNota', alignment: 'right' },
        { text: '%', style: 'thNota', alignment: 'right' },
      ],
      ...n.lineas.map((l) => [
        { text: l.codigo, color: C.suave, fontSize: 7.5 },
        { text: l.nombre },
        num(l.actual), num(l.anterior), num(l.variacion, { color: C.suave }), pct(l.porcentaje),
      ] as TableCell[]),
      [
        '', { text: `Total nota ${n.numero}`, bold: true, color: C.marino },
        num(n.totalActual, { bold: true, color: C.marino }),
        num(n.totalAnterior, { bold: true, color: C.marino }),
        num(n.variacion, { bold: true, color: C.suave }),
        pct(n.porcentaje, { bold: true }),
      ],
    ]
    out.push({
      unbreakable: n.lineas.length <= 18,
      margin: [0, 6, 0, 10],
      stack: [
        {
          text: [{ text: `Nota ${n.numero}.  `, color: C.acento }, { text: n.titulo }],
          style: 'tituloNota',
          headlineLevel: 1,
        },
        { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 512, y2: 2, lineWidth: 0.8, lineColor: C.acento }], margin: [0, 0, 0, 4] },
        {
          table: { headerRows: 1, widths: [52, '*', 64, 64, 58, 34], body },
          layout: {
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
              i === node.table.body.length - 1 ? 0.7 : i === node.table.body.length ? 1.4 : i === 1 ? 0.5 : 0.25,
            vLineWidth: () => 0,
            hLineColor: (i: number, node: { table: { body: unknown[] } }) =>
              i >= node.table.body.length - 1 ? C.marino : C.borde,
            paddingTop: () => 2,
            paddingBottom: () => 2,
          },
        },
      ],
    })
  }
  return out
}

export function definicionPDF(d: DocumentoFinanciero): TDocumentDefinitions {
  const empresa = d.encabezado.razonSocial || ''
  const docDef: TDocumentDefinitions = {
    pageSize: 'LETTER',
    pageMargins: [50, 70, 50, 56],
    info: {
      title: `Estados financieros ${empresa} ${d.periodoActual}`,
      author: d.encabezado.contador || 'SusConsultores',
      subject: textoCorte(d),
    },
    // Un título de nota nunca queda solo al final de la página.
    pageBreakBefore: (nodo, siguientes) =>
      nodo.headlineLevel === 1 && siguientes.filter((x) => x.headlineLevel === undefined).length < 8,
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: C.texto, lineHeight: 1.1 },
    background: (pagina) =>
      pagina === 1
        ? {
            canvas: [
              { type: 'rect', x: 0, y: 0, w: 612, h: 18, color: C.marino },
              { type: 'rect', x: 0, y: 18, w: 612, h: 4, color: C.acento },
              { type: 'rect', x: 0, y: 770, w: 612, h: 22, color: C.claro },
            ],
          }
        : '',
    header: (pagina) =>
      pagina === 1
        ? ''
        : {
            margin: [50, 26, 50, 0],
            columns: [
              { text: [{ text: empresa, bold: true, color: C.marino }, d.encabezado.nit ? { text: `   NIT ${d.encabezado.nit}`, color: C.suave } : ''], fontSize: 7.5 },
              { text: `Estados financieros ${d.periodoActual}`, alignment: 'right', fontSize: 7.5, color: C.suave },
            ],
          },
    footer: (pagina, total) =>
      pagina === 1
        ? ''
        : {
            margin: [50, 18, 50, 0],
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 512, y2: 0, lineWidth: 0.5, lineColor: C.borde }] },
              {
                margin: [0, 5, 0, 0],
                columns: [
                  { text: 'Las notas adjuntas son parte integral de estos estados financieros.', fontSize: 7, color: C.suave, italics: true },
                  { text: `Página ${pagina} de ${total}`, alignment: 'right', fontSize: 7, color: C.suave },
                ],
              },
            ],
          },
    content: [
      ...portada(d),
      { text: '', pageBreak: 'after' },
      { text: '', id: 'esf' },
      bloqueTitulo(d, 'Estado de situación financiera', textoCorte(d)),
      tablaEstado(d, d.esf),
      bloqueFirmas(d),
      { text: '', pageBreak: 'after' },
      { text: '', id: 'er' },
      bloqueTitulo(d, 'Estado de resultados', textoPeriodoResultados(d)),
      tablaEstado(d, d.er),
      bloqueFirmas(d),
      { text: '', pageBreak: 'after' },
      { text: '', id: 'notas' },
      ...notas(d),
    ],
    styles: {
      empresa: { fontSize: 13, bold: true, color: C.marino, alignment: 'center' },
      nit: { fontSize: 8.5, color: C.suave, alignment: 'center', margin: [0, 1, 0, 0] },
      tituloEstado: { fontSize: 11, bold: true, alignment: 'center', margin: [0, 8, 0, 1] },
      subtitulo: { fontSize: 8.5, alignment: 'center' },
      moneda: { fontSize: 7.5, italics: true, color: C.suave, alignment: 'center', margin: [0, 1, 0, 0] },
      th: { bold: true, color: 'white', fontSize: 8, margin: [0, 2, 0, 2] },
      thNota: { bold: true, color: C.suave, fontSize: 7.5, fillColor: C.gris },
      tituloNota: { fontSize: 9.5, bold: true, color: C.marino },
      portadaEmpresa: { fontSize: 24, bold: true, color: C.marino, alignment: 'center' },
      portadaNit: { fontSize: 11, color: C.suave, alignment: 'center', margin: [0, 4, 0, 0] },
      portadaTitulo: { fontSize: 18, bold: true, alignment: 'center', characterSpacing: 1.5 },
      portadaCorte: { fontSize: 12, alignment: 'center', margin: [0, 6, 0, 0] },
      portadaMoneda: { fontSize: 9, italics: true, color: C.suave, alignment: 'center', margin: [0, 4, 0, 0] },
    },
  }
  return docDef
}

export async function exportarPDF(d: DocumentoFinanciero): Promise<void> {
  const [{ default: pdfMake }, fuentes] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const vfs = (fuentes as unknown as { default?: Record<string, string> }).default ?? (fuentes as unknown as Record<string, string>)
  ;(pdfMake as unknown as { vfs: Record<string, string> }).vfs = vfs
  const blob = await new Promise<Blob>((resolve) => pdfMake.createPdf(definicionPDF(d)).getBlob(resolve))
  descargar(blob, nombreArchivo(d, 'pdf'))
}
