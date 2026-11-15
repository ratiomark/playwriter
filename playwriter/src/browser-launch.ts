import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export type BrowserLaunchOptions = {
  extensionPath: string
  userDataDir: string
  headless: boolean
  noSandbox?: boolean
  url?: string
}

export function getDefaultBrowserUserDataDir(): string {
  return path.join(os.homedir(), '.playwriter', 'browser-profile')
}

export function getBrowserLaunchArgs({
  extensionPath,
  userDataDir,
  headless,
  noSandbox = false,
  url = 'about:blank',
}: BrowserLaunchOptions): string[] {
  const args = [
    `--user-data-dir=${path.resolve(userDataDir)}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${path.resolve(extensionPath)}`,
    `--load-extension=${path.resolve(extensionPath)}`,
  ]

  if (headless) {
    args.push('--headless=new')
  }

  if (noSandbox) {
    args.push('--no-sandbox', '--disable-setuid-sandbox')
  }

  args.push(url)
  return args
}

export function startBrowserProcess({
  browserPath,
  args,
  userDataDir,
}: {
  browserPath: string
  args: string[]
  userDataDir: string
}): { pid: number } {
  fs.mkdirSync(path.resolve(userDataDir), { recursive: true })

  const browserProcess = spawn(browserPath, args, {
    detached: true,
    stdio: 'ignore',
  })
  browserProcess.unref()

  if (!browserProcess.pid) {
    throw new Error(`Failed to start browser process for ${browserPath}`)
  }

  return { pid: browserProcess.pid }
}
