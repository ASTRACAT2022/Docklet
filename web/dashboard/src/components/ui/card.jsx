import { cn } from '../../lib/utils'

function Card({ className = '', ...props }) {
  return (
    <div
      className={cn('rounded-xl border border-zinc-800 bg-zinc-900/80 shadow-lg', className)}
      {...props}
    />
  )
}

function CardHeader({ className = '', ...props }) {
  return <div className={cn('border-b border-zinc-800 p-4', className)} {...props} />
}

function CardTitle({ className = '', ...props }) {
  return <h3 className={cn('text-base font-semibold text-zinc-100', className)} {...props} />
}

function CardContent({ className = '', ...props }) {
  return <div className={cn('p-4', className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardContent }
