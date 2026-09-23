import { Linking, Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import type { SchoolDetail, ShiftPeriod, Student } from '@/api/types'
import { Avatar } from '@/components/Avatar'
import { CallButton } from '@/components/CallButton'
import { BottomSheet } from '@/components/Dialogs'
import { Icon } from '@/components/Icon'
import { Banner } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { formatTimeOfDay, telHref } from '@/lib/format'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { homeAddress, shiftName } from './data'

export interface SheetTarget {
  studentId: string
  schoolId: string
  period: ShiftPeriod
  /** Effective pickup/drop-off time for that shift, "HH:MM:SS". */
  time: string | null
  parentSkipped: boolean
}

// Student sheet (design 3a): who they are, where they are going on this shift, the office's
// note, every contact with a call button, and the school. Real data only, from
// GET /students/:id (which includes the extra contacts) and GET /schools/:id.
export function StudentSheet({ target, onClose }: { target: SheetTarget; onClose: () => void }) {
  const colors = useColors()

  // Same query key the Today list uses, so this is usually already in the cache.
  const studentQuery = useQuery({
    queryKey: ['student', target.studentId],
    queryFn: () => api.get<Student>(`/students/${target.studentId}`),
  })
  const schoolQuery = useQuery({
    queryKey: ['school-detail', target.schoolId],
    queryFn: () => api.get<SchoolDetail>(`/schools/${target.schoolId}`),
  })

  const s = studentQuery.data
  const school = schoolQuery.data
  const home = homeAddress(s)

  const homeStop = {
    label: 'Home',
    line: home ? `${home.line1} · ${home.line2}` : 'No home address on file',
  }
  const schoolLine = school
    ? [school.address, [school.state, school.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    : ''
  const schoolStop = { label: school?.name ?? 'School', line: schoolLine || 'No address on file' }
  // Morning runs home → school; the afternoon run is the other way round.
  const [from, to] = target.period === 'morning' ? [homeStop, schoolStop] : [schoolStop, homeStop]

  const meta = s
    ? [s.grade ? `Grade ${s.grade}` : null, s.age != null ? `Age ${s.age}` : null].filter(Boolean).join(' · ')
    : ''
  const contacts = s?.contacts ?? []
  const hasNoContacts = Boolean(s) && !s?.parent_name && !s?.parent_phone && contacts.length === 0

  return (
    <BottomSheet
      label={s?.full_name ?? 'Student'}
      onClose={onClose}
      header={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: 14,
          }}
        >
          <Avatar name={s?.full_name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={18} weight="semibold" numberOfLines={1}>
              {s?.full_name ?? 'Loading…'}
            </Text>
            {meta ? (
              <Text size={13} color={colors.muted}>
                {meta}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface2,
            }}
          >
            <Icon name="close" size={20} color={colors.ink} />
          </Pressable>
        </View>
      }
    >
      {/* Route card: From → To with the design's dot / line / square markers. */}
      <View
        style={{
          gap: 10,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <Text size={12} weight="semibold" color={colors.muted}>
          {shiftName(target.period)} {target.period === 'morning' ? 'pickup' : 'drop-off'}
          {target.time ? ` · ${formatTimeOfDay(target.time)}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 14, alignItems: 'center', paddingTop: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.ink }} />
            <View style={{ flex: 1, width: 2, marginVertical: 3, backgroundColor: colors.line }} />
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.ink }} />
          </View>
          <View style={{ flex: 1, gap: 12 }}>
            {[from, to].map((stop, i) => (
              <View key={i}>
                <Text size={14} weight="medium">
                  {stop.label}
                </Text>
                <Text size={13} color={colors.muted}>
                  {stop.line}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {target.parentSkipped ? (
        <Banner
          toneName="info"
          label={`Parent skipped this ${
            target.period === 'morning' ? "morning's pickup" : "afternoon's drop-off"
          }. No stop needed.`}
        />
      ) : null}

      {s?.notes ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            borderRadius: radius.card,
            backgroundColor: colors.noteBg,
            padding: 12,
          }}
        >
          <Icon name="sticky-note-2" size={20} color={colors.noteIcon} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={12} weight="semibold" color={colors.noteFg}>
              Note
            </Text>
            <Text size={14} color={colors.noteFg} style={{ lineHeight: 20 }}>
              {s.notes}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Text size={12} weight="semibold" color={colors.muted}>
          Parents &amp; contacts
        </Text>
        {hasNoContacts ? (
          <Text size={13} color={colors.muted}>
            No contacts on file. Ask the office to add one.
          </Text>
        ) : null}
        {s && (s.parent_name || s.parent_phone) ? (
          <ContactRow
            name={s.parent_name ?? 'Parent / guardian'}
            relationship="Primary contact"
            phone={s.parent_phone}
            primary
          />
        ) : null}
        {contacts.map((c) => (
          <ContactRow key={c.id} name={c.name} relationship={c.relationship ?? 'Contact'} phone={c.phone} />
        ))}
      </View>

      <View style={{ gap: 4 }}>
        <Text size={12} weight="semibold" color={colors.muted}>
          School
        </Text>
        {school ? (
          <View style={{ gap: 3 }}>
            <Text size={14} weight="medium">
              {school.name}
            </Text>
            {schoolLine ? (
              <Text size={13} color={colors.muted}>
                {schoolLine}
              </Text>
            ) : null}
            {school.phone || school.hours ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {school.phone ? (
                  <Pressable
                    onPress={() => void Linking.openURL(telHref(school.phone!))}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${school.name}`}
                    hitSlop={8}
                  >
                    <Text size={13} color={colors.muted} style={{ textDecorationLine: 'underline' }}>
                      {school.phone}
                    </Text>
                  </Pressable>
                ) : null}
                {school.phone && school.hours ? (
                  <Text size={13} color={colors.muted}>
                    ·
                  </Text>
                ) : null}
                {school.hours ? (
                  <Text size={13} color={colors.muted}>
                    {school.hours}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : schoolQuery.isError ? (
          <Text size={13} color={colors.muted}>
            School details could not be loaded.
          </Text>
        ) : (
          <Text size={13} color={colors.muted}>
            Loading…
          </Text>
        )}
      </View>
    </BottomSheet>
  )
}

function ContactRow({
  name,
  relationship,
  phone,
  primary = false,
}: {
  name: string
  relationship: string
  phone: string | null
  primary?: boolean
}) {
  const colors = useColors()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={14} weight="medium" numberOfLines={1}>
          {name}
        </Text>
        <Text size={12} color={colors.muted} numberOfLines={1}>
          {relationship}
          {phone ? ` · ${phone}` : ' · No phone on file'}
        </Text>
      </View>
      {phone ? <CallButton phone={phone} primary={primary} label={`Call ${name}`} /> : null}
    </View>
  )
}
