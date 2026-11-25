import type { OrderDetails } from '../domain/model'
import { AccessOrder, CheckTraffic } from './access'
import type { OrderExtension } from './extension'
import { MaintainOrders } from './maintenance'
import { AdministerOrder, ReadOrders } from './orders'
import { ProcessPayment } from './payments'
import { PlaceOrder } from './place'
import type {
  Clock,
  EmailBrand,
  Identifiers,
  Mailer,
  OrderLinks,
  PaymentGateway,
  Signer,
  TrafficLimiter,
  UnitOfWork,
} from './ports'

export interface OrdersPorts<D extends OrderDetails, X> {
  uow: UnitOfWork<D, X>
  traffic: TrafficLimiter
  clock: Clock
  ids: Identifiers
  signer: Signer
  payments: PaymentGateway
  mailer: Mailer
  links: OrderLinks
  brand: EmailBrand
  extension: OrderExtension<D, X>
}

export function createOrdersApplication<D extends OrderDetails, X>(ports: OrdersPorts<D, X>) {
  const access = new AccessOrder(ports.signer, ports.ids)
  const payments = new ProcessPayment(
    ports.uow,
    ports.clock,
    ports.payments,
    access,
    ports.extension,
  )
  return {
    place: new PlaceOrder(ports.uow, ports.clock, ports.ids, ports.payments, ports.extension),
    payments,
    orders: new ReadOrders(ports.uow, access, ports.payments, ports.clock, ports.extension),
    admin: new AdministerOrder(ports.uow, ports.clock, ports.extension),
    access,
    traffic: new CheckTraffic(ports.traffic, ports.signer, ports.clock),
    maintenance: new MaintainOrders(
      ports.uow,
      ports.clock,
      ports.payments,
      payments,
      ports.mailer,
      ports.links,
      ports.brand,
      ports.extension,
    ),
  }
}
export type OrdersApplication<D extends OrderDetails = OrderDetails, X = object> = ReturnType<
  typeof createOrdersApplication<D, X>
>
