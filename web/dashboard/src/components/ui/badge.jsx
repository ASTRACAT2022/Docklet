import { cn } from '../../lib/utils'

const variantClasses = {
  default: 'border-zinc-700 bg-zinc-800 text-zinc-200',
  success: 'border-emerald-700 bg-emerald-500/15 text-emerald-300',
  warning: 'border-amber-700 bg-amber-500/15 text-amber-300',
  danger: 'border-rose-700 bg-rose-500/15 text-rose-300',
}

function Badge({ className = '', variant = 'default', ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        variantClasses[variant] || variantClasses.default,
        className,
      )}
      {...props}
    />
  )
}

export { Badge }
