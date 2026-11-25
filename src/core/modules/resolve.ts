import type { CollectionConfig, GlobalConfig, TaskConfig } from 'payload'
import type { SiteModule } from './types'

export interface ResolvedModules {
  /** Module names, each after the modules it depends on. */
  names: string[]
  dependencies: Record<string, readonly string[]>
  collections: CollectionConfig[]
  globals: GlobalConfig[]
  tasks: TaskConfig[]
  queues: string[]
  /** Dashboard panel component paths, in module order. */
  dashboard: string[]
  /** Contributions received by each entry, keyed by the receiving module's name. */
  extensions: Record<string, unknown[]>
  routes: Record<string, readonly string[]>
}

/** Checks the registry and gathers what the modules bring; throws on any inconsistency. */
export function resolveModules(modules: readonly SiteModule[]): ResolvedModules {
  const byName = new Map<string, SiteModule>()
  for (const entry of modules) {
    if (byName.has(entry.name)) throw new Error(`Module enregistré deux fois : ${entry.name}`)
    byName.set(entry.name, entry)
  }
  for (const entry of modules) {
    for (const dependency of entry.dependsOn)
      if (!byName.has(dependency))
        throw new Error(`Module ${entry.name} : dépendance non enregistrée ${dependency}`)
    for (const target of Object.keys(entry.extensions ?? {}))
      if (!entry.dependsOn.includes(target))
        throw new Error(`Module ${entry.name} : extension de ${target} sans dépendance déclarée`)
  }

  const ordered: SiteModule[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (entry: SiteModule, path: string[]) => {
    const current = state.get(entry.name)
    if (current === 'done') return
    if (current === 'visiting')
      throw new Error(`Cycle de dépendances : ${[...path, entry.name].join(' -> ')}`)
    state.set(entry.name, 'visiting')
    for (const dependency of entry.dependsOn) {
      const target = byName.get(dependency)
      if (target) visit(target, [...path, entry.name])
    }
    state.set(entry.name, 'done')
    ordered.push(entry)
  }
  for (const entry of modules) visit(entry, [])

  const extensions: Record<string, unknown[]> = {}
  for (const entry of ordered)
    for (const [target, value] of Object.entries(entry.extensions ?? {}))
      (extensions[target] ??= []).push(value)

  const resolved: ResolvedModules = {
    names: ordered.map((entry) => entry.name),
    dependencies: Object.fromEntries(ordered.map((entry) => [entry.name, entry.dependsOn])),
    collections: [],
    globals: [],
    tasks: [],
    queues: [],
    dashboard: [],
    extensions,
    routes: Object.fromEntries(ordered.map((entry) => [entry.name, entry.routes ?? []])),
  }
  const owners = new Map<string, string>()
  const claim = (kind: string, slug: string, entry: string) => {
    const owner = owners.get(`${kind}:${slug}`)
    if (owner) throw new Error(`${kind} ${slug} déclaré par ${owner} et ${entry}`)
    owners.set(`${kind}:${slug}`, entry)
  }
  for (const entry of ordered) {
    const extra = entry.setup?.({ extensionsFor: (target) => extensions[target] ?? [] }) ?? {}
    for (const collection of [...(entry.collections ?? []), ...(extra.collections ?? [])]) {
      claim('collection', collection.slug, entry.name)
      resolved.collections.push(collection)
    }
    for (const global of [...(entry.globals ?? []), ...(extra.globals ?? [])]) {
      claim('global', global.slug, entry.name)
      resolved.globals.push(global)
    }
    resolved.tasks.push(...(entry.tasks ?? []), ...(extra.tasks ?? []))
    resolved.dashboard.push(...(entry.dashboard ?? []))
    for (const queue of entry.queues ?? [])
      if (!resolved.queues.includes(queue)) resolved.queues.push(queue)
  }
  return resolved
}

/**
 * The extensions addressed to `target`, as wired into the Payload config (config.custom.site),
 * keeping only those of the expected shape.
 */
export function extensionsOf<T>(
  payload: { config: { custom?: Record<string, unknown> } },
  target: string,
  isExtension: (value: unknown) => value is T,
): readonly T[] {
  const site = payload.config.custom?.['site'] as
    { extensions?: Record<string, unknown[]> } | undefined
  return (site?.extensions?.[target] ?? []).filter(isExtension)
}
