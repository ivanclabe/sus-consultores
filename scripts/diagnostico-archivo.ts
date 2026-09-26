/**
 * Corre la extracción completa sobre un Excel real y muestra lo que obtuvo.
 * No escribe nada en ningún lado.
 *
 *   npx esbuild scripts/diagnostico-archivo.ts --bundle --platform=node \
 *     --format=cjs --outfile=/tmp/diag.cjs && node /tmp/diag.cjs "<ruta.xlsx>"
 */
import { readFileSync } from 'node:fs'
import { leerLibro } from '../src/lib/excel'
import { analizarLibro, clasificarLibro } from '../src/lib/clasificarHojas'
import { procesarLibro } from '../src/lib/procesarLibro'

const ruta = process.argv[2]
if (!ruta) {
  console.error('Uso: node diag.cjs <archivo.xlsx>')
  process.exit(2)
}
const buf = readFileSync(ruta)
const wb = leerLibro(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
const perfiles = analizarLibro(wb)
const c = clasificarLibro(perfiles)
console.log(`\nCLASIFICACIÓN (${c.metodo}): actual ${c.anioActual} · anterior ${c.anioAnterior}`)
for (const h of c.hojas) {
  console.log(`  ${h.nombre.padEnd(26)} ${h.tipo.padEnd(8)} ${h.anios.join(',').padEnd(22)} → ${h.destino.padEnd(9)} ${h.motivo.slice(0, 90)}`)
}

const r = procesarLibro(wb, c)
const deCuenta = r.cuentas.filter((c) => c.nivel !== 'tercero')
const porNivel: Record<string, number> = {}
for (const c of r.cuentas) porNivel[c.nivel] = (porNivel[c.nivel] ?? 0) + 1
console.log('\nCUENTAS', porNivel, '· hojas:', deCuenta.filter((c) => c.esHoja).length)
console.log('  solo en año actual:', deCuenta.filter((c) => c.filaAnterior === null).length,
  '· solo en año anterior:', deCuenta.filter((c) => c.filaActual === null).length)
console.log('\nMUESTRA (rama 11)')
for (const c of r.cuentas.filter((c) => c.codigo.startsWith('11')).slice(0, 12)) {
  console.log(`  ${c.nivel.padEnd(11)} ${c.codigo.padEnd(12)} ${c.nombre.slice(0, 30).padEnd(30)} ${String(c.actual).padStart(14)} ${String(c.anterior).padStart(14)}  ${c.celdaActual ?? ''}`)
}
if (r.notas) {
  console.log(`\nNOTAS: ${r.notas.notas.length} · encabezado de años fila ${r.notas.filaAnios} ·`, r.notas.columnasAnios)
  for (const n of r.notas.notas) {
    const tot = [...n.lineas].reverse().find((l) => l.tipo === 'total')
    console.log(`  #${String(n.orden).padStart(2)} nota ${String(n.numero ?? '—').padEnd(3)} ${n.titulo.slice(0, 44).padEnd(44)} ${String(n.lineas.length).padStart(3)} líneas` +
      (tot ? `  total ${tot.actual} / ${tot.anterior}` : '') + (n.seccion ? `  [${n.seccion}]` : ''))
  }
}
console.log('\nVALIDACIONES')
for (const v of r.validaciones) console.log(`  ${v.ok ? 'ok   ' : v.bloqueante ? 'BLOQ ' : 'aviso'} ${v.codigo} ${v.titulo}\n        ${v.detalle}`)
const motivos: Record<string, number> = {}
for (const d of r.descartes) motivos[d.motivo] = (motivos[d.motivo] ?? 0) + 1
console.log('\nNO INCORPORADAS', motivos)
