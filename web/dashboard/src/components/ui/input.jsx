import { cn } from '../../lib/utils'

function Input({ className = '', ...props }) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
