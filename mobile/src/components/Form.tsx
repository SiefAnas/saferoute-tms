import { useState, type ReactNode } from 'react'
import { Pressable, TextInput, View, type TextInputProps } from 'react-native'
import { Icon } from '@/components/Icon'
import { Text } from '@/components/Text'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Form pieces shared by the signed-out screens (sign in, set your password, forgot password).

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const colors = useColors()
  return (
    <View style={{ gap: 6 }}>
      <Text size={12} weight="semibold" color={colors.muted}>
        {label}
      </Text>
      {children}
      {hint ? (
        <Text size={12} color={colors.muted} style={{ lineHeight: 17 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

// 52px tall, the same as the primary button: easy to hit on a phone in a van.
export function inputStyle(ink: string, line: string, surface: string) {
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

// Password box with a show/hide button.
export function PasswordInput({ label, ...props }: { label: string } & Omit<TextInputProps, 'secureTextEntry' | 'style'>) {
  const colors = useColors()
  const [show, setShow] = useState(false)
  return (
    <View style={{ position: 'relative', justifyContent: 'center' }}>
      <TextInput
        placeholderTextColor={colors.faint}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        style={[inputStyle(colors.ink, colors.line, colors.surface), { paddingRight: 52 }]}
        {...props}
      />
      <Pressable
        onPress={() => setShow((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={show ? 'Hide password' : 'Show password'}
        hitSlop={8}
        style={{ position: 'absolute', right: 8, padding: 10 }}
      >
        <Icon name={show ? 'visibility-off' : 'visibility'} size={20} color={colors.muted} />
      </Pressable>
    </View>
  )
}
