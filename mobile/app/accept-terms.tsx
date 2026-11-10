import { useRef, useState } from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { ActionError, messageFor } from '@/components/States'
import { parseMarkdown, splitFrontmatter, type Block, type Inline } from '@/lib/legalMarkdown'
import { nextScreenFor } from '@/lib/roles'
import { useColors } from '@/theme/theme'

type DocId = 'terms' | 'privacy'
const TITLES: Record<DocId, string> = { terms: 'Terms of Use', privacy: 'Privacy Policy' }
const WEBSITE = 'https://saferoute-tms-client.onrender.com'

interface LegalDoc {
  version: string
  effective: string
  blocks: Block[]
}

function useLegalDoc(id: DocId) {
  return useQuery({
    queryKey: ['legal', id],
    queryFn: async (): Promise<LegalDoc> => {
      const d = await api.get<{ version: string; effective: string; markdown: string }>(`/legal/${id}`)
      return { version: d.version, effective: d.effective, blocks: parseMarkdown(splitFrontmatter(d.markdown).body) }
    },
    staleTime: 10 * 60 * 1000,
  })
}

// Inline text: bold runs and links. A link to a site path (/privacy) opens the website.
function Inlines({ parts, size, color }: { parts: Inline[]; size: number; color: string }) {
  const colors = useColors()
  return (
    <Text size={size} color={color} style={{ lineHeight: size * 1.5 }}>
      {parts.map((p, i) =>
        p.href ? (
          <Text
            key={i}
            size={size}
            weight="medium"
            color={colors.ink}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => void Linking.openURL(p.href!.startsWith('/') ? WEBSITE + p.href : p.href!)}
          >
            {p.text}
          </Text>
        ) : (
          <Text key={i} size={size} weight={p.bold ? 'semibold' : 'regular'} color={p.bold ? colors.ink : color}>
            {p.text}
          </Text>
        ),
      )}
    </Text>
  )
}

function DocBlocks({ blocks }: { blocks: Block[] }) {
  const colors = useColors()
  return (
    <View style={{ gap: 12 }}>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const size = b.level === 1 ? 22 : b.level === 2 ? 17 : 15
          return (
            <View key={i} style={{ paddingTop: b.level === 1 ? 0 : 6 }}>
              <Inlines parts={b.text.map((t) => ({ ...t, bold: true }))} size={size} color={colors.ink} />
            </View>
          )
        }
        if (b.kind === 'list')
          return (
            <View key={i} style={{ gap: 6 }}>
              {b.items.map((it, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: 8, paddingRight: 4 }}>
                  <Text size={14} color={colors.muted} style={{ lineHeight: 21 }}>
                    •
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Inlines parts={it} size={14} color={colors.muted} />
                  </View>
                </View>
              ))}
            </View>
          )
        if (b.kind === 'quote')
          return (
            <View key={i} style={{ backgroundColor: colors.noteBg, borderRadius: 10, padding: 12 }}>
              <Inlines parts={b.text} size={14} color={colors.noteFg} />
            </View>
          )
        return <Inlines key={i} parts={b.text} size={14} color={colors.muted} />
      })}
    </View>
  )
}

// First sign-in (and whenever a new version is published): agree to the Terms of Use and Privacy
// Policy, or sign out. The root layout sends the user here after the password change. Both
// documents scroll above, but the "I agree" bar is pinned to the bottom and works right away.
export default function AcceptTermsScreen() {
  const colors = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { status, user, acceptLegal, signOut } = useAuth()
  const terms = useLegalDoc('terms')
  const privacy = useLegalDoc('privacy')
  const scroller = useRef<ScrollView>(null)
  const privacyY = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'signedOut' || !user) return <Redirect href="/login" />
  if (user.must_change_password || !user.legal_pending) return <Redirect href={nextScreenFor(user)} />

  const loaded = Boolean(terms.data && privacy.data)

  async function agree() {
    if (!terms.data || !privacy.data || busy) return
    setError(null)
    setBusy(true)
    try {
      const updated = await acceptLegal({ terms: terms.data.version, privacy: privacy.data.version })
      router.replace(nextScreenFor(updated))
    } catch (err) {
      setError(messageFor(err, 'Could not save your agreement. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface }}>
        <Text size={22} weight="semibold" style={{ letterSpacing: -0.4 }}>
          Before you continue
        </Text>
        <Text size={14} color={colors.muted}>
          Welcome, {user.full_name}. Please review the SafeTurns Terms of Use and Privacy Policy. You need to agree to them to use SafeTurns.
        </Text>
        <View style={{ flexDirection: 'row', gap: 16, paddingTop: 2 }}>
          <Text size={13} weight="medium" style={{ textDecorationLine: 'underline' }} onPress={() => scroller.current?.scrollTo({ y: 0, animated: true })}>
            Terms of Use
          </Text>
          <Text size={13} weight="medium" style={{ textDecorationLine: 'underline' }} onPress={() => scroller.current?.scrollTo({ y: privacyY.current, animated: true })}>
            Privacy Policy
          </Text>
        </View>
      </View>

      <ScrollView ref={scroller} contentContainerStyle={{ padding: 20, gap: 28 }}>
        {(['terms', 'privacy'] as DocId[]).map((id) => {
          const q = id === 'terms' ? terms : privacy
          return (
            <View
              key={id}
              onLayout={id === 'privacy' ? (e) => (privacyY.current = e.nativeEvent.layout.y) : undefined}
              style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 10 }}
            >
              {q.data ? (
                <>
                  <Text size={12} color={colors.faint}>
                    Version {q.data.version} · effective {q.data.effective}
                  </Text>
                  <DocBlocks blocks={q.data.blocks} />
                </>
              ) : q.isError ? (
                <Text size={14} color={colors.dangerInk}>
                  Could not load the {TITLES[id]}. Check your connection and try again.
                </Text>
              ) : (
                <Text size={14} color={colors.muted}>
                  Loading the {TITLES[id]}…
                </Text>
              )}
            </View>
          )
        })}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 12, gap: 10 }}>
        <Text size={13} color={colors.muted}>
          By tapping <Text size={13} weight="semibold">I agree</Text>, you agree to the SafeTurns Terms of Use
          {terms.data ? ` (v${terms.data.version})` : ''} and Privacy Policy{privacy.data ? ` (v${privacy.data.version})` : ''}.
        </Text>
        {error ? <ActionError message={error} /> : null}
        {terms.isError || privacy.isError ? (
          <Button label="Try again" variant="outline" onPress={() => { void terms.refetch(); void privacy.refetch() }} />
        ) : null}
        <Button label="I agree" busy={busy} busyLabel="Saving…" disabled={!loaded} onPress={agree} />
        <Button label="Decline and sign out" variant="ghost" disabled={busy} onPress={() => void signOut()} />
      </View>
    </View>
  )
}
