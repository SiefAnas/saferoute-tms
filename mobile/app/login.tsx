import { Copyright } from '@/components/Copyright'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { ActionError, messageFor, SLOW_AFTER_MS, SLOW_MESSAGE } from '@/components/States'
import { APP_NAME } from '@/config'
import { destinationForRole } from '@/lib/roles'
import { radius } from '@/theme/tokens'
import { Field, inputStyle, PasswordInput } from '@/components/Form'
import { useColors } from '@/theme/theme'

export default function LoginScreen() {
  const colors = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { signIn, expiredMessage, clearExpiredMessage } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Sign-in is usually the first request after the API has been idle, so it's the one most
  // likely to be slow while the server wakes up. Say so instead of leaving a silent spinner.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => {
      clearTimeout(t)
      setSlow(false)
    }
  }, [busy])

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    clearExpiredMessage()
    try {
      const user = await signIn(email, password)
      // Replace, so Back from inside the app never returns to the login form. An account on a
      // temporary password (new, or reset by the admin) chooses its own password first.
      router.replace(user.must_change_password ? '/set-password' : destinationForRole(user.role))
    } catch (err) {
      setError(messageFor(err, 'Could not sign in. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
            {APP_NAME}
          </Text>
          <Text size={14} color={colors.muted}>
            Sign in with the email and password your company gave you.
          </Text>
        </View>

        {expiredMessage ? (
          <View
            style={{
              backgroundColor: colors.cautionBg,
              borderRadius: radius.row,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text size={13} color={colors.cautionFg}>
              {expiredMessage}
            </Text>
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
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
              returnKeyType="next"
              accessibilityLabel="Email"
              style={inputStyle(colors.ink, colors.line, colors.surface)}
            />
          </Field>

          <Field label="Password">
            <PasswordInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          </Field>
        </View>

        {error ? <ActionError message={error} /> : null}

        <Button label="Sign in" busy={busy} busyLabel="Signing in…" disabled={!canSubmit} onPress={submit} />
        {busy && slow ? (
          <Text size={13} color={colors.muted} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            {SLOW_MESSAGE}
          </Text>
        ) : null}

        <Pressable
          onPress={() => router.push('/forgot-password')}
          accessibilityRole="link"
          hitSlop={8}
          style={{ alignSelf: 'center', paddingVertical: 8 }}
        >
          <Text size={14} weight="medium" color={colors.ink}>
            Forgot password?
          </Text>
        </Pressable>
        <Copyright />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
