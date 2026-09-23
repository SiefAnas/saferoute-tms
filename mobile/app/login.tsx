import { useEffect, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { Icon } from '@/components/Icon'
import { Text } from '@/components/Text'
import { ActionError, messageFor, SLOW_AFTER_MS, SLOW_MESSAGE } from '@/components/States'
import { APP_NAME } from '@/config'
import { destinationForRole } from '@/lib/roles'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

export default function LoginScreen() {
  const colors = useColors()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { signIn, expiredMessage, clearExpiredMessage } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      // Replace, so Back from inside the app never returns to the login form.
      router.replace(destinationForRole(user.role))
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
            <View style={{ position: 'relative', justifyContent: 'center' }}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                placeholderTextColor={colors.faint}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={submit}
                accessibilityLabel="Password"
                style={[inputStyle(colors.ink, colors.line, colors.surface), { paddingRight: 52 }]}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                hitSlop={8}
                style={{ position: 'absolute', right: 8, padding: 10 }}
              >
                <Icon name={showPassword ? 'visibility-off' : 'visibility'} size={20} color={colors.muted} />
              </Pressable>
            </View>
          </Field>
        </View>

        {error ? <ActionError message={error} /> : null}

        <Button label="Sign in" busy={busy} busyLabel="Signing in…" disabled={!canSubmit} onPress={submit} />
        {busy && slow ? (
          <Text size={13} color={colors.muted} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            {SLOW_MESSAGE}
          </Text>
        ) : null}

        {/* There is no password reset endpoint (API_CONTRACT.md section 2, V2_ROADMAP.md):
            drivers and parents get their password from the admin who created the account, and
            only that admin can change it. Same static message as the web login. */}
        <Text size={13} color={colors.muted} style={{ textAlign: 'center', lineHeight: 19 }}>
          Forgot password? Contact your company administrator.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors()
  return (
    <View style={{ gap: 6 }}>
      <Text size={12} weight="semibold" color={colors.muted}>
        {label}
      </Text>
      {children}
    </View>
  )
}

// 52px tall, the same as the primary button: easy to hit on a phone in a van.
function inputStyle(ink: string, line: string, surface: string) {
  return {
    height: 52,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: line,
    backgroundColor: surface,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: ink,
  }
}
