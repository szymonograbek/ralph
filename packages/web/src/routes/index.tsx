import { Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Effect } from 'effect'
import clsx from 'clsx'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { HttpClientService, Repository } from '../services/HttpClient'
import { useRuntime } from '../main'

export function Home() {
  const runtime = useRuntime()
  const [repositories, setRepositories] = useState<ReadonlyArray<Repository>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const fetchRepositories = async () => {
    setLoading(true)
    setError(null)

    const program = Effect.gen(function* () {
      const service = yield* HttpClientService
      return yield* service.fetchRepositories
    }).pipe(
      Effect.catchAll((err) => Effect.succeed({ error: err.message }))
    )

    const result = await runtime.runPromise(program)

    if ('error' in result) {
      setError(result.error)
    } else {
      setRepositories(result)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchRepositories()
  }, [])

  const handleCreateRepository = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dirInput.trim()) return

    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(false)

    const program = Effect.gen(function* () {
      const service = yield* HttpClientService
      yield* service.createRepository(dirInput.trim())
    }).pipe(
      Effect.catchAll((err) => Effect.succeed({ error: err.message }))
    )

    const result = await runtime.runPromise(program)

    if (result && 'error' in result) {
      setSubmitError(result.error)
      setSubmitting(false)
    } else {
      setSubmitSuccess(true)
      setDirInput('')
      setTimeout(() => {
        setIsDialogOpen(false)
        setSubmitSuccess(false)
      }, 1000)
      await fetchRepositories()
      setSubmitting(false)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  return (
    <div className="max-w-7xl mx-auto px-4">
      <div className="flex flex-row justify-between items-center mb-8 gap-4 flex-wrap">
        <h1 className="m-0">Repositories</h1>
        <button
          onClick={() => setIsDialogOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white border-none rounded cursor-pointer text-base hover:bg-blue-700"
        >
          Create Repository
        </button>
      </div>

      {loading && <LoadingSkeleton variant="card" count={3} />}
      {error && <p className="text-red-600">Error: {error}</p>}

      {!loading && !error && repositories.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <p className="text-xl mb-4">No repositories yet</p>
          <p>Click "Create Repository" to add your first repository</p>
        </div>
      )}

      {!loading && !error && repositories.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
          {repositories.map((repo) => (
            <Link
              key={repo.id}
              to="/repositories/$name"
              params={{ name: repo.name }}
              className="no-underline text-inherit border border-gray-300 rounded-lg p-6 bg-white transition-shadow hover:shadow-lg"
            >
              <h3 className="mt-0 mb-2">{repo.name}</h3>
              <p className="my-2 text-sm text-gray-600 break-all">
                {repo.path}
              </p>
              <p className="mt-2 mb-0 text-xs text-gray-400">
                Created: {formatDate(repo.createdAt)}
              </p>
            </Link>
          ))}
        </div>
      )}

      {isDialogOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
          onClick={() => setIsDialogOpen(false)}
        >
          <div
            className="bg-white rounded-lg p-8 max-w-lg w-[calc(100%-2rem)] m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mt-0">Create Repository</h2>
            <form onSubmit={handleCreateRepository}>
              <div className="mb-4">
                <label
                  htmlFor="dir"
                  className="block mb-2 font-bold"
                >
                  Directory Path
                </label>
                <input
                  id="dir"
                  type="text"
                  value={dirInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDirInput(e.target.value)}
                  placeholder="/path/to/git/repository"
                  className="w-full px-2 py-2 text-base border border-gray-300 rounded box-border"
                  required
                  disabled={submitting}
                />
                <p className="text-[0.85rem] text-gray-600 mt-2">
                  Must be a valid git repository path
                </p>
              </div>

              {submitError && (
                <p className="text-red-600 text-sm mb-4">{submitError}</p>
              )}

              {submitSuccess && (
                <p className="text-green-600 text-sm mb-4">
                  Repository created successfully!
                </p>
              )}

              <div className="flex gap-4 justify-end">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={submitting}
                  className={clsx(
                    "px-4 py-2 bg-gray-600 text-white border-none rounded text-base",
                    submitting ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-700"
                  )}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !dirInput.trim()}
                  className={clsx(
                    "px-4 py-2 text-white border-none rounded text-base",
                    submitting || !dirInput.trim()
                      ? "bg-gray-600 cursor-not-allowed opacity-60"
                      : "bg-blue-600 cursor-pointer hover:bg-blue-700"
                  )}
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
