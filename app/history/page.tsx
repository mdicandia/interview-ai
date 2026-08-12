import { HistoryView } from '@/components/HistoryView'

/**
 * A client page: the history lives in localStorage, so there is nothing a server
 * component could render here.
 */
export default function HistoryPage() {
  return <HistoryView />
}
