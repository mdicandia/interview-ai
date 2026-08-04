import { SessionPicker } from '@/components/SessionPicker'
import { buildCatalogue } from '@/lib/session/catalogue'

/**
 * Server component. It builds the metadata-only catalogue here so that problem
 * definitions — reference solutions, question answer keys — never enter the
 * client bundle, while the picker still gets everything it needs to compose a
 * session in the browser.
 */
export default function Home() {
  return <SessionPicker catalogue={buildCatalogue()} />
}
