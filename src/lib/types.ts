export type Nivel = 'grupo' | 'cuenta' | 'subcuenta' | 'auxiliar' | 'subauxiliar'
export type EstadoFinanciero = 'ESF' | 'ER'
export type OrigenClasificacion = 'regla' | 'memoria' | 'ia' | 'manual'
export type EstadoClasificacion = 'propuesta' | 'confirmada' | 'sin_clasificar' | 'excluida'

export interface Rubro {
  id: string
  codigo: string
  estado: EstadoFinanciero
  seccion: string
  nombre: string
  nota_numero: number | null
  orden: number
  naturaleza: 'deudora' | 'acreedora'
  activo: boolean
  origen: string
}

export interface ReglaMapeo {
  prefijo: string
  rubro_codigo: string
  prioridad: number
  activo: boolean
}

export interface Empresa {
  id: string
  nombre: string
  nit: string | null
}

export interface Informe {
  id: string
  empresa_id: string | null
  nombre_archivo: string
  hoja_origen: string | null
  hoja_anterior?: string | null
  hoja_notas?: string | null
  periodo_actual: number
  periodo_anterior: number | null
  estado: 'borrador' | 'en_revision' | 'aprobado'
  mapeo_columnas: unknown
  created_at: string
  aprobado_at: string | null
}

export interface Cuenta {
  id: string
  informe_id: string
  fila_origen: number | null
  codigo: string
  nombre: string
  nivel: Nivel | 'tercero'
  es_hoja: boolean
  /** null = la cuenta no existe en la hoja de ese año (faltante, no cero). */
  saldo_actual: number | null
  saldo_anterior: number | null
  clave?: string | null
  codigo_padre?: string | null
  nit?: string | null
  fila_anterior?: number | null
  celda_actual?: string | null
  celda_anterior?: string | null
  saldo_inicial?: number | null
}

export interface Clasificacion {
  id: string
  informe_id: string
  cuenta_id: string
  rubro_codigo: string | null
  confianza: number | null
  origen: OrigenClasificacion
  estado: EstadoClasificacion
  razon: string | null
}

/** Cuenta + su clasificación, que es lo que la UI y los cálculos usan. */
export interface CuentaClasificada extends Cuenta {
  clasificacion: Clasificacion
}

export interface LineaNota {
  codigo: string
  nombre: string
  actual: number
  anterior: number | null
}

export interface Nota {
  numero: number
  titulo: string
  rubros: string[]
  detalle: LineaNota[]
  totalActual: number
  totalAnterior: number | null
}

export interface LineaEstado {
  tipo: 'rubro' | 'subtotal' | 'total'
  etiqueta: string
  nota: number | null
  actual: number
  anterior: number | null
}

export interface ResultadoValidacion {
  codigo: string
  titulo: string
  ok: boolean
  bloqueante: boolean
  detalle: string
}
