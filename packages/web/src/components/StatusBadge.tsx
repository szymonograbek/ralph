import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

interface StatusBadgeProps {
  status: 'running' | 'stopped' | 'completed' | 'errored'
  size?: 'small' | 'medium' | 'large'
}

const statusClasses = {
  running: 'bg-green-100 text-green-800',
  stopped: 'bg-gray-200 text-gray-700',
  completed: 'bg-blue-100 text-blue-800',
  errored: 'bg-red-100 text-red-800',
} as const

const statusLabels = {
  running: 'running',
  stopped: 'stopped',
  completed: 'completed',
  errored: 'errored',
} as const

const sizeClasses = {
  small: 'px-2 py-1 text-[0.85rem]',
  medium: 'px-4 py-2 text-[0.9rem]',
  large: 'px-5 py-3 text-base',
} as const

export function StatusBadge({ status, size = 'small' }: StatusBadgeProps) {
  return (
    <span
      className={twMerge(
        clsx(
          'inline-block whitespace-nowrap rounded font-bold',
          statusClasses[status],
          sizeClasses[size]
        )
      )}
    >
      {statusLabels[status]}
    </span>
  )
}
