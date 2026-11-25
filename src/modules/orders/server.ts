import { getPayload } from 'payload'
import config from '@payload-config'
import { createOrders } from './composition'
export async function getOrders() {
  return createOrders(await getPayload({ config }))
}
