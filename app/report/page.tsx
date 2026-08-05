import { ReportView } from '@/components/ReportView'

/**
 * A client page, unusually for this app.
 *
 * The evidence it reports on lives in localStorage — there is no database and no
 * user — so there is nothing a server component could render here.
 */
export default function ReportPage() {
  return <ReportView />
}
