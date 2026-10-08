/**
 * Datos corporativos leídos del propio libro: razón social, NIT, fecha de corte
 * y firmantes. Van al encabezado del informe final.
 *
 * Fuentes, de mayor a menor confianza:
 *   1. Cabecera de Siigo en los balances usados ("Siigo - EMPRESA SAS", "NIT 900507954 -3",
 *      "De : ENE 1/2025 A : DIC 31/2025").
 *   2. Cabecera de las hojas de estados ya armados ("EMPRESA S.A.S.", "NIT. 900.507.954-3").
 *   3. Notas y otras hojas.
 *
 * Si otra hoja menciona una empresa distinta (una plantilla copiada de otro
 * cliente, por ejemplo) se reporta: no se decide en silencio.
 */
import type * as XLSX from 'xlsx'
import { abrirHoja, celda, normalizar, ref, texto, type Hoja } from './excel'

export interface Encabezado {
  razonSocial: string
  nit: string
  ciudad: string
  /** "31 de diciembre de 2025" */
  fechaCorte: string
  fechaCorteAnterior: string
  moneda: string
  representanteLegal: string
  contador: string
  tarjetaContador: string
  revisorFiscal: string
  tarjetaRevisor: string
}

export interface Hallazgo {
  valor: string
  hoja: string
  celda: string
}

export interface DatosCorporativos {
  razonSocial: Hallazgo | null
  nit: Hallazgo | null
  corteActual: Hallazgo | null
  corteAnterior: Hallazgo | null
  representanteLegal: Hallazgo | null
  contador: Hallazgo | null
  tarjetaContador: Hallazgo | null
  revisorFiscal: Hallazgo | null
  tarjetaRevisor: Hallazgo | null
  software: string | null
  /** Otras empresas mencionadas en el libro (posible hoja de otro cliente). */
  otrasEmpresas: Hallazgo[]
}

export const MONEDA_POR_DEFECTO = 'Cifras expresadas en pesos colombianos (COP)'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES_CORTO: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
}

const FILAS_CABECERA = 10
const COLUMNAS_CABECERA = 16

/** "SAS" → "S.A.S.", "LTDA" → "LTDA.", espacios normalizados. */
export function presentarRazonSocial(s: string): string {
  let r = s.replace(/\s+/g, ' ').trim()
  r = r.replace(/\bS\.?\s?A\.?\s?S\.?$/i, 'S.A.S.')
  r = r.replace(/\bLTDA\.?$/i, 'LTDA.')
  r = r.replace(/\bS\.\s?A\.?$/i, 'S.A.')
  return r
}

/** Llave para comparar nombres: sin puntos, tildes ni sufijo societario. */
export const llaveEmpresa = (s: string): string =>
  normalizar(s)
    .replace(/[.,]/g, '')
    .replace(/\b(s ?a ?s|sas|ltda|s ?a|eu|sca|y cia|& cia)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** "900507954 -3", "900,888.897-5", "NIT 901.466.842-3" → "900.507.954-3". */
export function normalizarNit(crudo: string): string | null {
  const s = crudo.replace(/^.*?\bnit\b\.?\s*:?\s*/i, '')
  const m = s.match(/^([\d][\d.,\s]*\d)\s*(?:-\s*(\d))?/)
  if (!m) return null
  const base = m[1].replace(/\D/g, '')
  if (base.length < 6 || base.length > 12) return null
  const conPuntos = base.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return m[2] ? `${conPuntos}-${m[2]}` : conPuntos
}

export const digitosNit = (nit: string | null | undefined): string =>
  (nit ?? '').split('-')[0].replace(/\D/g, '')

const SUFIJO = /\b(S\.?\s?A\.?\s?S\.?|S\.\s?A\.?|LTDA\.?|E\.?\s?U\.?|S\.?\s?C\.?\s?A\.?|&\s?CIA\.?|COOPERATIVA|FUNDACI[OÓ]N|CORPORACI[OÓ]N|ASOCIACI[OÓ]N)\s*$/i
const NO_ES_NOMBRE = /estado|balance|nota|nit\b|cifras|periodo|período|comparativ|expresad|resultado|situaci|flujo|patrimonio|indicador|procesado|prueba|de :|\d{4}/i

function filaDeTexto(h: Hoja, r: number): { textos: string[]; refs: string[] } {
  const textos: string[] = []
  const refs: string[] = []
  for (let c = 0; c <= Math.min(h.ultimaColumna, COLUMNAS_CABECERA); c++) {
    const t = texto(celda(h, r, c))
    if (t) {
      textos.push(t)
      refs.push(ref(r, c))
    }
  }
  return { textos, refs }
}

/** "De : ENE 1/2025 A : DIC 31/2025" o "DIC/31/2025" → { dia, mes, anio } del corte. */
export function corteDeTexto(t: string): { dia: number; mes: number; anio: number } | null {
  const rango = t.match(/\bA\s*:?\s*([A-Za-z]{3})\.?\s*(\d{1,2})\s*\/\s*(\d{4})/i)
  if (rango) {
    const mes = MES_CORTO[rango[1].toLowerCase()]
    if (mes) return { dia: Number(rango[2]), mes, anio: Number(rango[3]) }
  }
  const siigo = t.match(/\b([A-Za-z]{3})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\b/)
  if (siigo) {
    const mes = MES_CORTO[siigo[1].toLowerCase()]
    if (mes) return { dia: Number(siigo[2]), mes, anio: Number(siigo[3]) }
  }
  return null
}

export const fechaLarga = (f: { dia: number; mes: number; anio: number }): string =>
  `${f.dia} de ${MESES[f.mes - 1]} de ${f.anio}`

/** Fecha de corte por defecto cuando el archivo no la trae: 31 de diciembre. */
export const corteAnual = (anio: number | null): string => (anio ? `31 de diciembre de ${anio}` : '')

const ROLES: [keyof Pick<DatosCorporativos, 'representanteLegal' | 'contador' | 'revisorFiscal'>, RegExp][] = [
  ['representanteLegal', /representante\s+legal/i],
  ['contador', /contador(a)?(\s+p[uú]blic[oa])?$/i],
  ['revisorFiscal', /revisor(a)?\s+fiscal/i],
]

const pareceNombre = (t: string): boolean =>
  /^[A-Za-zÁÉÍÓÚÑáéíóúñü.'\s]{5,60}$/.test(t) &&
  t.trim().split(/\s+/).length >= 2 &&
  t.trim().split(/\s+/).length <= 6 &&
  !/representante|contador|revisor|firma|legal|fiscal/i.test(t)

const tarjeta = (t: string): string | null => {
  const m = t.match(/\bT\.?\s?P\.?\s*(?:No\.?|N°)?\s*:?\s*([\d][\d.\-\s]*[\dA-Z])/i)
  return m ? m[1].replace(/\s+/g, '') : null
}

/** Busca firmantes en las últimas filas de la hoja: nombre encima o debajo del rol. */
function firmantes(h: Hoja, out: DatosCorporativos) {
  const desde = Math.max(0, h.ultimaFila - 60)
  for (let r = desde; r <= h.ultimaFila; r++) {
    for (let c = 0; c <= Math.min(h.ultimaColumna, COLUMNAS_CABECERA); c++) {
      const t = texto(celda(h, r, c))
      if (!t) continue
      for (const [rol, re] of ROLES) {
        if (!re.test(t) || out[rol]) continue
        for (const dr of [-1, -2, 1, 2, -3]) {
          const cand = texto(celda(h, r + dr, c))
          if (cand && pareceNombre(cand)) {
            out[rol] = { valor: cand.replace(/\s+/g, ' ').trim(), hoja: h.nombre, celda: ref(r + dr, c) }
            break
          }
        }
        if (rol !== 'representanteLegal') {
          const clave = rol === 'contador' ? 'tarjetaContador' : 'tarjetaRevisor'
          for (const dr of [0, 1, 2, -1]) {
            const tp = tarjeta(texto(celda(h, r + dr, c)))
            if (tp && !out[clave]) {
              out[clave] = { valor: tp, hoja: h.nombre, celda: ref(r + dr, c) }
              break
            }
          }
        }
      }
    }
  }
}

/**
 * @param prioridad hojas en orden de confianza (balance actual, anterior, estados, notas…).
 *                  Las que no estén se recorren al final.
 */
export function extraerDatosCorporativos(
  wb: XLSX.WorkBook,
  prioridad: { actual: string[]; anterior: string[]; resto: string[] },
): DatosCorporativos {
  const out: DatosCorporativos = {
    razonSocial: null, nit: null, corteActual: null, corteAnterior: null,
    representanteLegal: null, contador: null, tarjetaContador: null,
    revisorFiscal: null, tarjetaRevisor: null, software: null, otrasEmpresas: [],
  }
  const vistos = new Set<string>()
  const orden = [...prioridad.actual, ...prioridad.anterior, ...prioridad.resto, ...wb.SheetNames]
    .filter((n) => wb.Sheets[n] && !vistos.has(n) && vistos.add(n))

  const empresas: (Hallazgo & { nit: Hallazgo | null })[] = []
  let primerNit: Hallazgo | null = null

  for (const nombre of orden) {
    const h = abrirHoja(wb, nombre)
    if (h.ultimaFila < 0) continue
    let empresaHoja: Hallazgo | null = null
    let nitHoja: Hallazgo | null = null

    for (let r = 0; r <= Math.min(h.ultimaFila, FILAS_CABECERA); r++) {
      const { textos, refs } = filaDeTexto(h, r)
      textos.forEach((t, i) => {
        if (empresaHoja) return
        const siigo = t.match(/^siigo\s*-\s*(.+)$/i)
        if (siigo) {
          empresaHoja = { valor: presentarRazonSocial(siigo[1]), hoja: nombre, celda: refs[i] }
          out.software ??= 'Siigo'
        } else if (SUFIJO.test(t) && !NO_ES_NOMBRE.test(t) && t.length <= 90) {
          empresaHoja = { valor: presentarRazonSocial(t), hoja: nombre, celda: refs[i] }
        }
      })
      const unida = textos.join(' ')
      const iNit = textos.findIndex((x) => /\bnit\b/i.test(x))
      if (!nitHoja && iNit >= 0) {
        const n = normalizarNit(textos.slice(iNit).join(' '))
        if (n) {
          nitHoja = { valor: n, hoja: nombre, celda: refs[iNit] }
          primerNit ??= nitHoja
          // Nombre en la fila de arriba cuando no trae sufijo societario.
          if (!empresaHoja && r > 0) {
            const arriba = filaDeTexto(h, r - 1)
            const k = arriba.textos.findIndex(
              (x) => !NO_ES_NOMBRE.test(x) && /[A-Za-z]{3}/.test(x) && x === x.toUpperCase() && x.length <= 90,
            )
            if (k >= 0) empresaHoja = { valor: presentarRazonSocial(arriba.textos[k]), hoja: nombre, celda: arriba.refs[k] }
          }
        }
      }
      const corte = corteDeTexto(unida)
      if (corte) {
        const destino = prioridad.actual.includes(nombre) ? 'corteActual'
          : prioridad.anterior.includes(nombre) ? 'corteAnterior' : null
        if (destino && !out[destino]) out[destino] = { valor: fechaLarga(corte), hoja: nombre, celda: refs[0] }
      }
    }
    if (empresaHoja) empresas.push({ ...(empresaHoja as Hallazgo), nit: nitHoja })
    firmantes(h, out)
  }

  if (empresas.length) {
    // La primera según la prioridad manda; las que tienen otro nombre u otro NIT se reportan.
    const principal = empresas[0]
    out.razonSocial = { valor: principal.valor, hoja: principal.hoja, celda: principal.celda }
    out.nit = principal.nit ?? empresas.find((e) => e.nit && llaveEmpresa(e.valor) === llaveEmpresa(principal.valor))?.nit ?? primerNit
    const llave = llaveEmpresa(principal.valor)
    const nitP = digitosNit(out.nit?.valor)
    const reportadas = new Set<string>()
    for (const e of empresas.slice(1)) {
      const otraLlave = llaveEmpresa(e.valor)
      const otroNit = digitosNit(e.nit?.valor)
      const nombreDistinto = otraLlave !== '' && otraLlave !== llave && !llave.includes(otraLlave) && !otraLlave.includes(llave)
      const nitDistinto = otroNit !== '' && nitP !== '' && otroNit !== nitP
      if ((nombreDistinto || nitDistinto) && !reportadas.has(otraLlave + otroNit)) {
        reportadas.add(otraLlave + otroNit)
        out.otrasEmpresas.push({ valor: e.nit ? `${e.valor} (NIT ${e.nit.valor})` : e.valor, hoja: e.hoja, celda: e.celda })
      }
    }
  } else {
    out.nit = primerNit
  }
  return out
}

/** Encabezado editable a partir de lo leído del archivo y de lo guardado para la empresa. */
export function encabezadoInicial(
  d: DatosCorporativos | null,
  anioActual: number | null,
  anioAnterior: number | null,
  guardado: Partial<Encabezado> = {},
): Encabezado {
  const v = (h: Hallazgo | null | undefined) => h?.valor ?? ''
  return {
    razonSocial: v(d?.razonSocial) || guardado.razonSocial || '',
    nit: v(d?.nit) || guardado.nit || '',
    ciudad: guardado.ciudad ?? '',
    fechaCorte: v(d?.corteActual) || corteAnual(anioActual),
    fechaCorteAnterior: v(d?.corteAnterior) || corteAnual(anioAnterior),
    moneda: guardado.moneda || MONEDA_POR_DEFECTO,
    representanteLegal: v(d?.representanteLegal) || guardado.representanteLegal || '',
    contador: v(d?.contador) || guardado.contador || '',
    tarjetaContador: v(d?.tarjetaContador) || guardado.tarjetaContador || '',
    revisorFiscal: v(d?.revisorFiscal) || guardado.revisorFiscal || '',
    tarjetaRevisor: v(d?.tarjetaRevisor) || guardado.tarjetaRevisor || '',
  }
}
