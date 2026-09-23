import { ActivityIndicator, View } from 'react-native'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { ApiError, NetworkError } from '@/api'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

// The design's empty state: a tinted icon tile, one title line, one explanatory line, and a
// next-step button where there is one. Never plain grey text.
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName
  title: string
  body: string
  action?: { label: string; onPress: () => void }
}) {
  const colors = useColors()
  return (
    <View
      style={{
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 16,
        paddingHorizontal: 24,
        paddingVertical: 32,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
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
          backgroundColor: colors.surface2,
        }}
      >
        <Icon name={icon} size={24} color={colors.muted} />
      </View>
      <Text size={15} weight="semibold" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text size={13} color={colors.muted} style={{ textAlign: 'center', lineHeight: 19 }}>
        {body}
      </Text>
      {action ? <Button compact variant="outline" label={action.label} onPress={action.onPress} /> : null}
    </View>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const colors = useColors()
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 48 }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.muted} />
      <Text size={13} color={colors.muted}>
        {label}
      </Text>
    </View>
  )
}

// One place that turns a thrown error into something a driver or parent can act on.
// A NetworkError gets "Try again" (the API is on a plan that spins down, so the first call
// after a quiet period really can time out); an ApiError shows the server's own message.
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = error instanceof NetworkError
  return (
    <EmptyState
      icon={offline ? 'cloud-off' : 'error-outline'}
      title={offline ? 'No connection' : 'Something went wrong'}
      body={
        offline
          ? 'SafeRoute could not be reached. Check your signal and try again — the first try after a quiet period can take a few seconds.'
          : error instanceof ApiError
            ? error.message
            : 'Please try again.'
      }
      action={{ label: 'Try again', onPress: onRetry }}
    />
  )
}

// Inline error for a failed action (check-in, logging a trip, skipping a pickup) — the server's
// message shown right above the button that caused it.
export function ActionError({ message }: { message: string }) {
  const colors = useColors()
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: colors.alertBg,
        borderRadius: radius.row,
        paddingHorizontal: 12,
        paddingVertical: 9,
      }}
    >
      <Text size={13} color={colors.alertFg}>
        {message}
      </Text>
    </View>
  )
}

// Turns a thrown error into the message for ActionError.
export function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof NetworkError) return error.message
  return fallback
}
