import { readiness } from '@/core/http/readiness'
export const dynamic = 'force-dynamic'
export function GET() {
  return readiness()
}
