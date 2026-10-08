import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5199 },
  build: {
    // Calcular el gzip de los chunks grandes (pdfmake, ExcelJS, fuentes) cuesta tiempo y
    // memoria en servidores pequeños, y no cambia el resultado.
    reportCompressedSize: false,
    // ExcelJS y pdfmake se cargan solo al exportar; su tamaño es esperado.
    chunkSizeWarningLimit: 1600,
  },
})
