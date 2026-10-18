import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { NameCell, NoMatches, PageIntro, SearchField, TableCard, TableRow, matches } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { SchoolSummary } from '../../types/api'

const TEMPLATE = '1.6fr 2fr 1.2fr 0.8fr'

// Who controls a school's details. A school the company added stays editable by the company only
// while it is unclaimed; once the school has its own SafeTurns account, its details are theirs.
function ownership(s: SchoolSummary): { label: string; tone: BadgeTone } {
  if (s.claim_status === 'claimed') return { label: 'Has an account', tone: 'success' }
  if (s.claim_status === 'pending_claim') return { label: 'Being claimed', tone: 'info' }
  if (s.added_by_you) return { label: 'Added by you', tone: 'neutral' }
  if (s.added_by_company) return { label: 'Added by your company', tone: 'neutral' }
  return { label: 'Added by another company', tone: 'neutral' }
}

// PATCH /placeholders/school/:id lets only the admin who added the school edit it today (see
// BACKLOG, "Placeholder edit rights"), so Edit is shown only for those.
const canEdit = (s: SchoolSummary) => s.claim_status === 'unclaimed' && s.added_by_you

// Company Admin — Schools. Students need a school, and this is the one place to add a school on
// its own (the Add Student form can also add one inline). It is also where an admin checks what
// already exists before importing students; a school file can be imported from Import, Schools.
export function CompanySchoolsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const schoolsQuery = useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })
  const [q, setQ] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setName('')
    setAddress('')
    setFormError(null)
  }

  function startAdd() {
    closeModal()
    setShowModal(true)
  }

  function startEdit(s: SchoolSummary) {
    setEditingId(s.id)
    setName(s.name)
    setAddress(s.address ?? '')
    setFormError(null)
    setShowModal(true)
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['schools'] })
  const payload = () => ({ name: name.trim(), address: address.trim() })

  const createSchool = useMutation({
    mutationFn: () => api.post<SchoolSummary>('/placeholders/school', payload()),
    onSuccess: (s) => {
      invalidate()
      closeModal()
      toast.show(`${s.name} added`)
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not add the school.'),
  })

  const updateSchool = useMutation({
    mutationFn: (id: string) => api.patch<SchoolSummary>(`/placeholders/school/${id}`, payload()),
    onSuccess: () => {
      invalidate()
      closeModal()
      toast.show('School updated')
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not update the school.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (editingId) updateSchool.mutate(editingId)
    else createSchool.mutate()
  }

  const schools = schoolsQuery.data ?? []
  const visible = schools.filter((s) => matches(q, s.name, s.address))
  const saving = createSchool.isPending || updateSchool.isPending

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Schools">
        <SearchField value={q} onChange={setQ} placeholder="Search schools" />
        <Button variant="outline" onClick={() => navigate('/company/import')}>
          <span className="material-symbols-outlined !text-[18px]">upload_file</span>
          Import schools
        </Button>
        <Button onClick={startAdd}>
          <span className="material-symbols-outlined !text-[18px]">add</span>
          Add school
        </Button>
      </PageTopBar>

      <PageIntro>The schools your students go to. Add your schools before you add or import students.</PageIntro>

      <TableCard template={TEMPLATE} columns={[{ label: 'School' }, { label: 'Address' }, { label: 'Details' }, { label: '' }]}>
        {schoolsQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : schools.length === 0 ? (
          <EmptyState
            icon="school"
            title="No schools yet"
            body="Add the schools your students go to, one at a time here or all at once from Import, Schools."
            action={<Button onClick={startAdd}>Add school</Button>}
          />
        ) : visible.length === 0 ? (
          <NoMatches q={q} hint="Search looks at school names and addresses." onClear={() => setQ('')} />
        ) : (
          visible.map((s) => {
            const own = ownership(s)
            return (
              <TableRow key={s.id} template={TEMPLATE}>
                <NameCell avatar={false} name={s.name} />
                <span className="truncate text-ink-sub">{s.address || '—'}</span>
                <span>
                  <StatusBadge tone={own.tone} label={own.label} />
                </span>
                <span className="flex justify-end">
                  {canEdit(s) && (
                    <Button variant="ghost" onClick={() => startEdit(s)}>
                      <span className="material-symbols-outlined !text-[18px]">edit</span>
                      Edit
                    </Button>
                  )}
                </span>
              </TableRow>
            )
          })
        )}
      </TableCard>

      {showModal && (
        <Modal title={editingId ? 'Edit school' : 'Add school'} onClose={closeModal}>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Field label="School name">
              <Input required maxLength={200} placeholder="Lincoln Elementary" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Address">
              <Input required maxLength={500} placeholder="100 Main St, Chicago" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <p className="text-[12px] text-muted">
              You can change these details until the school creates its own SafeTurns account. After that, only the school can.
            </p>
            {formError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add school'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {toast.node}
    </div>
  )
}
