// Pieces shared by the two import flows (one file of one type, and several files detected).
import { Button } from '../../components/Button'
import type { ImportCredential } from '../../types/api'

export function Counts({ items }: { items: [string, number][] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map(([label, n]) => (
        <div key={label} className="min-w-[130px] rounded-btn border border-line px-4 py-2.5">
          <div className="text-[22px] font-semibold text-ink">{n}</div>
          <div className="text-[12px] text-muted">{label}</div>
        </div>
      ))}
    </div>
  )
}

// Shown once, right after the import: the new accounts' temporary passwords.
export function CredentialsTable({ creds, onDownload }: { creds: ImportCredential[]; onDownload: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-btn border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[14px] font-semibold text-ink">New accounts and their temporary passwords</div>
        <Button type="button" onClick={onDownload}>
          <span className="material-symbols-outlined !text-[18px]">download</span>
          Download
        </Button>
      </div>
      <p className="rounded-row bg-caution-bg px-3 py-2 text-[13px] text-caution-fg">
        Shown only now. Download or copy this list before leaving the page. Each person signs in with their email and this password,
        then chooses their own. Passwords expire after 7 days. If the list is lost, use Reset password on the person's account.
      </p>
      <div className="max-h-[320px] overflow-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="py-1.5 pr-3 font-semibold">Name</th>
              <th className="py-1.5 pr-3 font-semibold">Email</th>
              <th className="py-1.5 font-semibold">Temporary password</th>
            </tr>
          </thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.email} className="border-t border-divider">
                <td className="py-1.5 pr-3 text-ink">{c.full_name}</td>
                <td className="py-1.5 pr-3 text-ink">{c.email}</td>
                <td className="py-1.5 font-mono font-semibold text-ink select-all">{c.temporary_password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
