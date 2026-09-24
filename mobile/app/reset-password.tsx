import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { ActionError, messageFor } from '@/components/States'
import { Field, inputStyle, PasswordInput } from '@/components/Form'
import { extractResetToken } from '@/lib/resetToken'
import { useColors } from '@/theme/theme'

const RULES = 'At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.'

// Second half of "Forgot password?", the same as the website's reset page: the code from the
// email link plus a new password (POST /auth/reset-password). Opened from a
// saferoute://reset-password?token=… link, or the user pastes the link from the email here.
export default function ResetPasswordScreen() {
  const colors = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ token?: string }>()
  const linkToken = extractResetToken(typeof params.token === 'string' ? `?token=${params.token}` : null)
  const [pasted, setPasted] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const token = linkToken ?? extractResetToken(pasted)
  const canSubmit = Boolean(token) && next.length > 0 && confirm.length > 0 && !busy

  async function submit() {
    if (!canSubmit || !token) return
    setError(null)
    if (next !== confirm) {
      setError("The new passwords don't match.")
      return
    }
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { token, newPassword: next })
      setDone(true)
    } catch (err) {
      setError(messageFor(err, 'Could not reset your password. Please try again.'))
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
            {done ? 'Password changed' : 'Set a new password'}
          </Text>
          <Text size={14} color={colors.muted}>
            {done
              ? 'Sign in with your new password. Every other device you were signed in on has been signed out.'
              : 'Use the link from the reset email. It works once, for 60 minutes.'}
          </Text>
        </View>

        {done ? (
          <Button label="Sign in" onPress={() => router.replace('/login')} />
        ) : (
          <>
            <View style={{ gap: 12 }}>
              {linkToken ? null : (
                <Field label="Reset link or code" hint="Copy the link from the email and paste it here.">
                  <TextInput
                    value={pasted}
                    onChangeText={setPasted}
                    placeholder="https://…/reset-password?token=…"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Reset link or code"
                    style={inputStyle(colors.ink, colors.line, colors.surface)}
                  />
                </Field>
              )}
              {!linkToken && pasted.trim() && !token ? <ActionError message="That doesn't look like a reset link. Copy the whole link from the email." /> : null}
              <Field label="New password" hint={RULES}>
                <PasswordInput label="New password" value={next} onChangeText={setNext} autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password">
                <PasswordInput label="Confirm new password" value={confirm} onChangeText={setConfirm} autoComplete="new-password" returnKeyType="done" onSubmitEditing={submit} />
              </Field>
            </View>
            {error ? <ActionError message={error} /> : null}
            <Button label="Save new password" busy={busy} busyLabel="Saving…" disabled={!canSubmit} onPress={submit} />
          </>
        )}

        {done ? null : <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/login')} />}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
