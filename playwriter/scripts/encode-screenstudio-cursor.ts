/**
 * Encodes the extracted Screen Studio cursor SVG as an inline markup TS module.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sourcePath = path.resolve(__dirname, '../src/assets/cursors/screen-studio/pointer-macos-tahoe.svg')
const outputPath = path.resolve(__dirname, '../src/assets/cursors/screen-studio/pointer-macos-tahoe-svg.ts')

function main() {
  const svg = fs.readFileSync(sourcePath, 'utf-8').trim()
  const output = `/**\n * Generated from pointer-macos-tahoe.svg via scripts/encode-screenstudio-cursor.ts.\n */\n\nexport const SCREENSTUDIO_POINTER_MACOS_TAHOE_SVG = ${JSON.stringify(svg)}\n`
  fs.writeFileSync(outputPath, output)
  console.log(`Wrote ${outputPath}`)
}

main()
