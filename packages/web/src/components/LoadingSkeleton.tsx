import clsx from 'clsx'

interface LoadingSkeletonProps {
  variant?: 'text' | 'card' | 'table-row'
  count?: number
}

export function LoadingSkeleton({
  variant = 'text',
  count = 1,
}: LoadingSkeletonProps) {
  const skeleton = (
    <div
      className={clsx(
        'w-full bg-gray-300 rounded relative overflow-hidden animate-pulse',
        {
          'h-[150px]': variant === 'card',
          'h-[60px]': variant === 'table-row',
          'h-5': variant === 'text',
        }
      )}
    />
  )

  return (
    <div
      className={clsx({
        'grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4': variant === 'card',
        'flex flex-col gap-2': variant === 'table-row' || variant === 'text',
      })}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>{skeleton}</div>
      ))}
    </div>
  )
}
