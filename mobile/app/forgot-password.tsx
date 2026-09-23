import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { ActionError, messageFor } from '@/components/States'
import { Field, inputStyle } from '@/components/Form'
import { useColors } from '@/theme/theme'

// "Forgot password?": asks the API to email a reset link. The answer is the same whether or
// not the email has an account. The link opens the SafeRoute website, where the new password is
// set; then the user signs in here with it.
export default function ForgotPasswordScreen() {
  const colors = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit = email.trim().length > 0 && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (err) {
      setError(messageFor(err, 'Something went wrong. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text size={24} weight="semibold" style={{ letterSpacing: -0.5 }}>
            Reset your password
          </Text>
          <Text size={14} color={colors.muted}>
            We&apos;ll email you a link to choose a new password.
          </Text>
        </View>

        {sent ? (
          <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
            <Text size={15} style={{ lineHeight: 22 }}>
              If an account uses {email.trim()}, we sent it a link to reset the password. It works once, for 60 minutes, and opens
              the SafeRoute website. Then sign in here with your new password.
            </Text>
            <Text size={13} color={colors.muted} style={{ lineHeight: 19 }}>
              No email? Ask your company administrator to reset your password for you.
            </Text>
          </View>
        ) : (
          <>
            <Field label="Email">
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                inputMode="email"
                returnKeyType="send"
                onSubmitEditing={submit}
                accessibilityLabel="Email"
                style={inputStyle(colors.ink, colors.line, colors.surface)}
              />
            </Field>
            {error ? <ActionError message={error} /> : null}
            <Button label="Send reset link" busy={busy} busyLabel="Sending…" disabled={!canSubmit} onPress={submit} />
          </>
        )}

        <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/login')} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
