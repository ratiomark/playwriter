// Reusable button with CVA variants and form pending states.
'use client'

import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { useFormStatus } from 'react-dom'
import { cn } from '../../lib/utils.ts'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    loadingText?: string
  }

export function Button({
  asChild = false,
  className,
  children,
  disabled,
  loading = false,
  loadingText,
  size = 'default',
  type,
  variant = 'default',
  ...props
}: ButtonProps) {
  const { pending } = useFormStatus()
  const isSubmit = type === 'submit'
  const isLoading = loading || (isSubmit && pending)
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot='button'
      aria-busy={isLoading || undefined}
      className={cn(buttonVariants({ variant, size }), isLoading && 'cursor-wait', className)}
      disabled={asChild ? undefined : disabled || isLoading}
      type={asChild ? undefined : type}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          {loadingText ?? children}
        </>
      ) : children}
    </Comp>
  )
}

export { buttonVariants }
