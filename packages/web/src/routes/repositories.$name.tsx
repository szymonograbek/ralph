import { Link, useParams } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { Effect } from 'effect'
import clsx from 'clsx'
import { StatusBadge } from '../components/StatusBadge'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { HttpClientService, Worker, WorkerFiberState } from '../services/HttpClient'
import { useRuntime } from '../main'

export function Repository() {
  const runtime = useRuntime()
  const { name } = useParams({ from: '/repositories/$name' })
  const [workers, setWorkers] = useState<ReadonlyArray<Worker>>([])
  const [workerStates, setWorkerStates] = useState<Map<string, WorkerFiberState>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(false)
  const [workerName, setWorkerName] = useState('')
  const [planMessage, setPlanMessage] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchWorkers = async () => {
    setError(null)

    const program = Effect.gen(function* () {
      const service = yield* HttpClientService
      return yield* service.fetchWorkers(name)
    }).pipe(
      Effect.catchAll((err) => Effect.succeed({ error: err.message }))
    )

    const result = await runtime.runPromise(program)

    if ('error' in result) {
      setError(result.error)
    } else {
      setWorkers(result)
    }
    setLoading(false)
  }

  const fetchWorkerStates = async () => {
    const states = new Map<string, WorkerFiberState>()
    for (const worker of workers) {
      const program = Effect.gen(function* () {
        const service = yield* HttpClientService
        return yield* service.fetchWorkerState(worker.name)
      }).pipe(
        Effect.catchAll(() => Effect.succeed(null))
      )

      const result = await runtime.runPromise(program)
      if (result) {
        states.set(worker.name, result)
      }
    }
    setWorkerStates(states)
  }

  useEffect(() => {
    fetchWorkers()
  }, [name])

  useEffect(() => {
    if (workers.length > 0) {
      fetchWorkerStates()

      // Poll every 2s
      pollIntervalRef.current = setInterval(() => {
        fetchWorkerStates()
      }, 2000)

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
        }
      }
    }
  }, [workers, name])

  const handleStartWorker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workerName.trim() || !planMessage.trim()) return

    setStarting(true)
    setStartError(null)

    const program = Effect.gen(function* () {
      const service = yield* HttpClientService
      yield* service.createWorker(name, workerName.trim(), planMessage.trim())
    }).pipe(
      Effect.catchAll((err) => Effect.succeed({ error: err.message }))
    )

    const result = await runtime.runPromise(program)

    if (result && 'error' in result) {
      setStartError(result.error)
    } else {
      setWorkerName('')
      setPlanMessage('')
      setIsStartDialogOpen(false)
      await fetchWorkers()
      setTimeout(() => fetchWorkerStates(), 500)
    }
    setStarting(false)
  }

  const handleStopWorker = async (workerName: string) => {
    setStopping(workerName)

    const program = Effect.gen(function* () {
      const service = yield* HttpClientService
      yield* service.stopWorker(name, workerName)
    }).pipe(
      Effect.catchAll((err) => Effect.succeed({ error: err.message }))
    )

    const result = await runtime.runPromise(program)

    if (result && 'error' in result) {
      alert(result.error)
    } else {
      setConfirmStop(null)
      await fetchWorkers()
      setTimeout(() => fetchWorkerStates(), 500)
    }
    setStopping(null)
  }

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

  const getStatus = (worker: Worker): 'stopped' | 'running' | 'completed' | 'errored' => {
    const state = workerStates.get(worker.name)
    return state ? state.status : 'stopped'
  }

  const getUptime = (worker: Worker): string => {
    const state = workerStates.get(worker.name)
    return state ? formatUptime(state.startedAt) : '-'
  }

  return (
    <div className="max-w-7xl mx-auto px-4">
      <div className="flex flex-row justify-between items-center mb-8 gap-4 flex-wrap">
        <h1 className="m-0">Repository: {name}</h1>
        <button
          onClick={() => setIsStartDialogOpen(true)}
          className="px-4 py-2 bg-green-600 text-white border-none rounded cursor-pointer text-base hover:bg-green-700"
        >
          Start Worker
        </button>
      </div>

      {loading && <LoadingSkeleton variant="table-row" count={3} />}
      {error && <p className="text-red-600">Error: {error}</p>}

      {!loading && !error && workers.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <p className="text-xl mb-4">No workers yet</p>
          <p>Click "Start Worker" to create your first worker</p>
        </div>
      )}

      {!loading && !error && workers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse bg-white border border-gray-300">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-4 text-left border-b-2 border-gray-300">Name</th>
                <th className="p-4 text-left border-b-2 border-gray-300">Branch</th>
                <th className="p-4 text-left border-b-2 border-gray-300">State</th>
                <th className="p-4 text-left border-b-2 border-gray-300">Uptime</th>
                <th className="p-4 text-left border-b-2 border-gray-300">Created</th>
                <th className="p-4 text-left border-b-2 border-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-300">
              {workers.map((worker) => {
                const status = getStatus(worker)
                const state = workerStates.get(worker.name)
                const isRunning = status === 'running'
                const isStopping = stopping === worker.name

                return (
                  <tr key={worker.name}>
                    <td className="p-4">
                      <Link
                        to="/repositories/$name/workers/$id"
                        params={{ name, id: worker.name }}
                        className="text-blue-600 no-underline hover:underline"
                      >
                        {worker.name}
                      </Link>
                    </td>
                    <td className="p-4 text-gray-600 text-sm">{worker.branch}</td>
                    <td className="p-4">
                      <StatusBadge status={status} />
                      {state?.currentTask && (
                        <div className="text-xs text-gray-600 mt-1">
                          {state.currentTask} (iter {state.iterationCount})
                        </div>
                      )}
                      {state?.error && (
                        <div className="text-xs text-red-600 mt-1">
                          {state.error}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-sm">{getUptime(worker)}</td>
                    <td className="p-4 text-sm text-gray-600">{formatDate(worker.createdAt)}</td>
                    <td className="p-4">
                      {isRunning && (
                        confirmStop === worker.name ? (
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={() => handleStopWorker(worker.name)}
                              disabled={isStopping}
                              className={clsx(
                                'py-1 px-3 bg-red-600 text-white border-none rounded text-sm',
                                isStopping ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-red-700'
                              )}
                            >
                              {isStopping ? 'Stopping...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmStop(null)}
                              disabled={isStopping}
                              className={clsx(
                                'py-1 px-3 bg-gray-600 text-white border-none rounded text-sm',
                                isStopping ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-700'
                              )}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmStop(worker.name)}
                            disabled={isStopping}
                            className="py-1 px-3 bg-red-600 text-white border-none rounded text-sm cursor-pointer hover:bg-red-700"
                          >
                            Stop
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {isStartDialogOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000]"
          onClick={() => setIsStartDialogOpen(false)}
        >
          <div
            className="bg-white rounded-lg p-8 max-w-2xl w-[calc(100%-2rem)] m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mt-0">Start Worker</h2>
            <form onSubmit={handleStartWorker}>
              <div className="mb-4">
                <label
                  htmlFor="workerName"
                  className="block mb-2 font-bold"
                >
                  Worker Name
                </label>
                <input
                  id="workerName"
                  type="text"
                  value={workerName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkerName(e.target.value)}
                  placeholder="feature-123"
                  className="w-full p-2 text-base border border-gray-300 rounded box-border"
                  required
                  disabled={starting}
                />
                <p className="text-sm text-gray-600 mt-2">
                  Unique identifier for this worker (used for branch and directory names)
                </p>
              </div>

              <div className="mb-4">
                <label
                  htmlFor="plan"
                  className="block mb-2 font-bold"
                >
                  Plan Message
                </label>
                <textarea
                  id="plan"
                  value={planMessage}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPlanMessage(e.target.value)}
                  placeholder="Describe what the worker should work on..."
                  rows={5}
                  className="w-full p-2 text-base border border-gray-300 rounded box-border font-inherit"
                  required
                  disabled={starting}
                />
                <p className="text-sm text-gray-600 mt-2">
                  This message will be used to generate a PRD for the worker
                </p>
              </div>

              {startError && (
                <p className="text-red-600 text-sm mb-4">{startError}</p>
              )}

              <div className="flex gap-4 justify-end">
                <button
                  type="button"
                  onClick={() => setIsStartDialogOpen(false)}
                  disabled={starting}
                  className={clsx(
                    'px-4 py-2 bg-gray-600 text-white border-none rounded text-base',
                    starting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-700'
                  )}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={starting || !workerName.trim() || !planMessage.trim()}
                  className={clsx(
                    'px-4 py-2 text-white border-none rounded text-base',
                    starting || !workerName.trim() || !planMessage.trim()
                      ? 'bg-gray-600 cursor-not-allowed opacity-60'
                      : 'bg-green-600 cursor-pointer hover:bg-green-700'
                  )}
                >
                  {starting ? 'Starting...' : 'Start'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
