// What the removal migration of a deployed site needs beyond what Payload generates, derived from
// the module manifests (used by scripts/remove-module.mjs, checked against PostgreSQL by the
// modules' integration tests).

/** The job task slugs of these module manifests: their own `tasks` and those their `setup` adds. */
export function taskSlugs(entries) {
  const slugs = new Set()
  for (const entry of entries) {
    for (const task of entry.tasks ?? []) slugs.add(task.slug)
    try {
      for (const task of entry.setup?.({ extensionsFor: () => [] })?.tasks ?? [])
        slugs.add(task.slug)
    } catch {
      // A module whose setup needs its extensions: its own tasks above are enough.
    }
  }
  return [...slugs]
}

/**
 * The statements that empty Payload's job tables of these task slugs. The generated removal
 * migration narrows the task slug enums by casting the columns through `text` and back; in
 * production a scheduled task always has its next run queued (and failed runs keep their log), so
 * the cast fails and the deploy stops unless these run first.
 */
export function jobPurgeStatements(slugs) {
  if (!slugs.length) return []
  const list = slugs.map((slug) => `'${slug.replaceAll("'", "''")}'`).join(', ')
  return [
    `DELETE FROM "payload_jobs_log" WHERE "task_slug" IN (${list});`,
    `DELETE FROM "payload_jobs" WHERE "task_slug" IN (${list});`,
  ]
}
