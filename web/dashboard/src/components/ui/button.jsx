import { cn } from '../../lib/utils'

const variantClasses = {
  default: 'bg-orange-600 text-white hover:bg-orange-500',
  outline: 'border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800',
  ghost: 'text-zinc-300 hover:bg-zinc-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
}

const sizeClasses = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
}

function Button({
  className = '',
  variant = 'default',
  size = 'md',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant] || variantClasses.default,
        sizeClasses[size] || sizeClasses.md,
        className,
      )}
      {...props}
    />
  )
}

export { Button }
