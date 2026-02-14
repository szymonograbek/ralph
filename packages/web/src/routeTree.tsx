import { createRootRoute, createRoute } from '@tanstack/react-router'
import { Root } from './routes/__root'
import { Home } from './routes/index'
import { Repository } from './routes/repositories.$name'
import { Worker } from './routes/repositories.$name.workers.$id'

const rootRoute = createRootRoute({
  component: Root,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
})

const repositoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/repositories/$name',
  component: Repository,
})

const workerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/repositories/$name/workers/$id',
  component: Worker,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  repositoryRoute,
  workerRoute,
])
