// Reusable centered auth layout used by login, device, and dashboard pages.
// Also exposes the shared Playwriter logo used by auth pages.

import type { ReactNode } from 'react'
import { Head } from 'spiceflow/react'
import { cn } from '../lib/utils.ts'

export function PlaywriterLogo({ className, imageClassName = 'h-7' }: { className?: string; imageClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <img
        src="/playwriter-logo.svg"
        alt="Playwriter"
        className={cn('w-auto dark:invert', imageClassName)}
      />
    </span>
  )
}

export function AuthPage({
  title,
  visualTitle,
  headTitle,
  description,
  children,
  footer,
}: {
  title: string
  visualTitle?: ReactNode
  headTitle?: string
  description: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <Head>
        <Head.Title>{`${headTitle ?? title} | Playwriter`}</Head.Title>
        <Head.Meta name="description" content={description} />
      </Head>
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{visualTitle ?? title}</h1>
          <p className="text-sm text-muted-foreground text-balance">{description}</p>
        </div>
        {children}
        {footer ? <div className="flex w-full flex-col gap-3">{footer}</div> : null}
      </div>
    </main>
  )
}
