import { Link, useParams } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Effect } from 'effect'
import { StatusBadge } from '../components/StatusBadge'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { HttpClientService, WorkerDetail } from '../services/HttpClient'
import { useRuntime } from '../main'

export function Worker() {
  const { name, id } = useParams({ from: '/repositories/$name/workers/$id' })
  const runtime = useRuntime()
  const [detail, setDetail] = useState<WorkerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set())

  const fetchDetail = async () => {
    setError(null)

    const program = Effect.gen(function* () {
      const service = yield* HttpClientService
      return yield* service.fetchWorkerDetail(name, id)
    }).pipe(
      Effect.catchAll((err) => Effect.succeed({ error: err.message }))
    )

    const result = await runtime.runPromise(program)

    if ('error' in result) {
      setError(result.error)
    } else {
      setDetail(result)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchDetail()

    // Poll every 3s for updates
    const interval = setInterval(fetchDetail, 3000)
    return () => clearInterval(interval)
  }, [name, id])

  const formatUptime = (startedAt: number) => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${hours}h ${minutes}m ${secs}s`
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const toggleStory = (storyId: string) => {
    setExpandedStories(prev => {
      const next = new Set(prev)
      if (next.has(storyId)) {
        next.delete(storyId)
      } else {
        next.add(storyId)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4">
        <LoadingSkeleton variant="card" count={2} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4">
        <p className="text-red-600">Error: {error}</p>
        <Link to="/repositories/$name" params={{ name }} className="text-blue-600 hover:text-blue-700">
          ← Back to {name}
        </Link>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="max-w-7xl mx-auto px-4">
        <p>Worker not found</p>
        <Link to="/repositories/$name" params={{ name }} className="text-blue-600 hover:text-blue-700">
          ← Back to {name}
        </Link>
      </div>
    )
  }

  const { state, prd } = detail

  return (
    <div className="max-w-7xl mx-auto px-4">
      <Link to="/repositories/$name" params={{ name }} className="text-blue-600 hover:text-blue-700 no-underline mb-4 inline-block">
        ← Back to {name}
      </Link>

      {/* Header with worker metrics */}
      <div className="bg-white border border-gray-300 rounded-lg p-6 mb-6">
        <div className="flex flex-row justify-between items-start mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="m-0 mb-2">Worker: {id}</h1>
            <p className="m-0 text-gray-600 text-sm">Repository: {name}</p>
          </div>
          <StatusBadge status={state.status} size="medium" />
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4 mt-4">
          <div>
            <div className="text-[0.85rem] text-gray-600 mb-1">Uptime</div>
            <div className="text-lg font-bold">{formatUptime(state.startedAt)}</div>
          </div>
          <div>
            <div className="text-[0.85rem] text-gray-600 mb-1">Iteration Count</div>
            <div className="text-lg font-bold">{state.iterationCount}</div>
          </div>
          {state.currentTask && (
            <div>
              <div className="text-[0.85rem] text-gray-600 mb-1">Current Task</div>
              <div className="text-lg font-bold break-words">{state.currentTask}</div>
            </div>
          )}
        </div>

        {state.error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-200 rounded break-words">
            <div className="text-[0.85rem] font-bold text-red-800 mb-2">
              Error occurred at {formatDate(state.startedAt)}
            </div>
            <div className="text-sm text-red-800">{state.error}</div>
          </div>
        )}
      </div>

      {/* PRD visualization */}
      {prd ? (
        <div>
          <div className="mb-4">
            <h2 className="m-0 mb-2">{prd.project.name}</h2>
            <p className="m-0 text-gray-600">{prd.project.description}</p>
          </div>

          <div className="flex flex-col gap-4">
            {prd.userStories.map((story) => {
              const isExpanded = expandedStories.has(story.id)
              const isCurrent = state.currentTask === story.id

              return (
                <div
                  key={story.id}
                  className={`bg-white rounded-lg overflow-hidden ${
                    isCurrent ? 'border-2 border-blue-600' : 'border border-gray-300'
                  }`}
                >
                  <div
                    onClick={() => toggleStory(story.id)}
                    className={`p-4 cursor-pointer flex justify-between items-center ${
                      isCurrent ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4 flex-1">
                      {story.passes && (
                        <span className="text-2xl text-green-600">✓</span>
                      )}
                      <div>
                        <div className="font-bold text-base">{story.title}</div>
                        <div className="text-[0.85rem] text-gray-600 mt-1">{story.id}</div>
                      </div>
                    </div>
                    <span className="text-xl text-gray-600">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="p-4 border-t border-gray-300 bg-gray-50">
                      <div className="mb-4">
                        <div className="text-[0.85rem] font-bold text-gray-600 mb-2">
                          Description
                        </div>
                        <div className="prose prose-sm max-w-none">
                          <p className="m-0">{story.description}</p>
                        </div>
                      </div>

                      <div className="mb-4">
                        <div className="text-[0.85rem] font-bold text-gray-600 mb-2">
                          Acceptance Criteria
                        </div>
                        <ul className="m-0 pl-6 prose prose-sm max-w-none list-disc">
                          {story.acceptanceCriteria.map((criterion, idx) => (
                            <li key={idx}>{criterion}</li>
                          ))}
                        </ul>
                      </div>

                      {story.notes && (
                        <div>
                          <div className="text-[0.85rem] font-bold text-gray-600 mb-2">
                            Notes
                          </div>
                          <div className="prose prose-sm max-w-none">
                            <p className="m-0 italic">{story.notes}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="text-center p-12 text-gray-600 bg-white border border-gray-300 rounded-lg">
          <p>No PRD available for this worker</p>
        </div>
      )}
    </div>
  )
}
