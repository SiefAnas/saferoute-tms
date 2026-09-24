import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { ActionError, messageFor } from '@/components/States'
import { Field, PasswordInput } from '@/components/Form'
import { destinationForRole } from '@/lib/roles'
import { useColors } from '@/theme/theme'

const RULES = 'At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.'

// First sign-in with the temporary password the company gave (or a reset by the admin): the
// user must choose their own password before anything else. The server enforces it too.
export default function SetPasswordScreen() {
  const colors = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { status, user, changePassword, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'signedOut' || !user) return <Redirect href="/login" />
  if (!user.must_change_password) return <Redirect href={destinationForRole(user.role)} />

  const canSubmit = current.length > 0 && next.length > 0 && confirm.length > 0 && !busy

  async function submit() {
    if (!canSubmit) return
    setError(null)
    if (next !== confirm) {
      setError("The new passwords don't match.")
      return
    }
    setBusy(true)
    try {
      const updated = await changePassword(current, next)
      router.replace(destinationForRole(updated.role))
    } catch (err) {
      setError(messageFor(err, 'Could not save your password. Please try again.'))
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
            Choose your password
          </Text>
          <Text size={14} color={colors.muted}>
            Welcome, {user.full_name}. Replace the temporary password you were given with your own.
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <Field label="Temporary password">
            <PasswordInput label="Temporary password" value={current} onChangeText={setCurrent} autoComplete="current-password" />
          </Field>
          <Field label="New password" hint={RULES}>
            <PasswordInput label="New password" value={next} onChangeText={setNext} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <PasswordInput
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          </Field>
        </View>

        {error ? <ActionError message={error} /> : null}

        <Button label="Save and continue" busy={busy} busyLabel="Saving…" disabled={!canSubmit} onPress={submit} />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
