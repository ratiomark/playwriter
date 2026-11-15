// Downloads Prism.js assets into <outDir>/src/ for welcome.html and tutorial.html.
// Chrome extension CSP blocks external scripts, so we bundle them locally.
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/'
const outDir = process.env.PLAYWRITER_EXTENSION_DIST || 'dist'
const DEST = path.join(outDir, 'src')

const files: [string, string][] = [
  ['prism.min.js', 'prism.min.js'],
  ['components/prism-bash.min.js', 'prism-bash.min.js'],
]

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          fs.writeFileSync(dest, Buffer.concat(chunks))
          resolve()
        })
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

async function main() {
  await Promise.all(
    files.map(([src, dest]) => {
      return download(BASE + src, path.join(DEST, dest))
    }),
  )
  console.log(`Downloaded ${files.length} Prism.js files to ${DEST}`)
}

main()
