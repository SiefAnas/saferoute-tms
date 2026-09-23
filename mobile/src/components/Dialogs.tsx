import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

// ── Confirm card ────────────────────────────────────────────────────────────
// A centered card 16px from the edges (design 3a): used before switching shifts, before
// checking out with stops left, and before skipping a parent's pickup.
export function ConfirmCard({
  title,
  body,
  cancelLabel = 'Cancel',
  confirmLabel,
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  cancelLabel?: string
  confirmLabel: string
  busy?: boolean
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const colors = useColors()
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{
            width: '100%',
            maxWidth: 400,
            gap: 8,
            padding: 20,
            borderRadius: radius.card,
            backgroundColor: colors.surface,
          }}
        >
          <Text size={17} weight="semibold">
            {title}
          </Text>
          <Text size={14} color={colors.muted} style={{ lineHeight: 20 }}>
            {body}
          </Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              busy={busy}
              onPress={onConfirm}
            />
            <Button label={cancelLabel} variant="ghost" disabled={busy} onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Bottom sheet ────────────────────────────────────────────────────────────
// Max 88% of the screen, radius 20 on the top corners, a 36×4 grabber, internal scroll.
export function BottomSheet({
  label,
  header,
  children,
  onClose,
}: {
  label: string
  header: ReactNode
  children: ReactNode
  onClose: () => void
}) {
  const colors = useColors()
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' }}>
        {/* Tapping the dimmed area closes the sheet, the same as the design's scrim. */}
        <Pressable style={{ flex: 1 }} accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} />
        <View
          accessibilityViewIsModal
          accessibilityLabel={label}
          style={{
            maxHeight: '88%',
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingBottom: 24,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line }} />
          </View>
          {header}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 12 }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// ── Coming soon ─────────────────────────────────────────────────────────────
// The same pattern as the web app's client/src/components/ComingSoon.tsx: features in
// V2_ROADMAP.md keep their place in the UI and say so, instead of showing invented data.
const ComingSoonContext = createContext<(feature?: string) => void>(() => {})

export function ComingSoonProvider({ children }: { children: ReactNode }) {
  const colors = useColors()
  const [feature, setFeature] = useState<string | null>(null)
  const open = useCallback((f?: string) => setFeature(f ?? ''), [])
  const close = useCallback(() => setFeature(null), [])
  const value = useMemo(() => open, [open])

  return (
    <ComingSoonContext.Provider value={value}>
      {children}
      {feature !== null && (
        <Modal transparent animationType="fade" visible onRequestClose={close}>
          <View
            style={{
              flex: 1,
              backgroundColor: colors.scrim,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <View
              accessibilityViewIsModal
              accessibilityRole="alert"
              style={{
                width: '100%',
                maxWidth: 352,
                alignItems: 'center',
                gap: 12,
                padding: 24,
                borderRadius: radius.card,
                backgroundColor: colors.surface,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.infoBg,
                }}
              >
                <Icon name="rocket-launch" size={24} color={colors.infoFg} />
              </View>
              <Text size={16} weight="semibold" style={{ textAlign: 'center' }}>
                {feature ? `${feature} is coming soon` : 'Coming soon'}
              </Text>
              <Text size={14} color={colors.muted} style={{ textAlign: 'center' }}>
                This feature is coming soon.
              </Text>
              <Button label="OK" onPress={close} style={{ alignSelf: 'stretch', marginTop: 4 }} />
            </View>
          </View>
        </Modal>
      )}
    </ComingSoonContext.Provider>
  )
}

export function useComingSoon(): (feature?: string) => void {
  return useContext(ComingSoonContext)
}

// A row that visibly leads to a Coming soon feature, like the parent app's
// "Live location and ETA". Keeps the design's place in the UI without faking the data.
export function ComingSoonRow({
  icon,
  label,
  feature,
}: {
  icon: IconName
  label: string
  feature: string
}) {
  const colors = useColors()
  const open = useComingSoon()
  return (
    <Pressable
      onPress={() => open(feature)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Coming soon.`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        borderRadius: radius.row,
        borderWidth: 1,
        borderColor: colors.line,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: pressed ? colors.surface2 : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Icon name={icon} size={18} color={colors.muted} />
        <Text size={13}>{label}</Text>
      </View>
      <View style={{ backgroundColor: colors.infoBg, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
        <Text size={11} weight="semibold" color={colors.infoFg}>
          Coming soon
        </Text>
      </View>
    </Pressable>
  )
}
