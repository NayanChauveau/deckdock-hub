import { SuggestAddresses } from './application/suggest-addresses'
import { GooglePlacesAddressProvider } from './adapters/google-places-provider'
import { PacedAddressProvider } from './adapters/paced-provider'

export const addressSuggestions = new SuggestAddresses(
  new PacedAddressProvider(new GooglePlacesAddressProvider(process.env['GOOGLE_MAPS_API_KEY'])),
)
