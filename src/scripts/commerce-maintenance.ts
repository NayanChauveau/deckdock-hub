import { getPayload } from 'payload'
import config from '../payload.config'
import { createOrders } from '../modules/orders/composition'
if (process.env.NODE_ENV === 'production' && process.env['GITHUB_ACTIONS'] !== 'true')
  throw new Error('Opérations de production uniquement par CI ou tâche Payload automatique.')
const payload = await getPayload({ config })
try {
  await createOrders(payload).maintenance.execute()
  console.log('Maintenance commerce terminée.')
} finally {
  await payload.destroy()
}
