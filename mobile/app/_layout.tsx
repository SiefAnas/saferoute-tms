import { useCallback, useEffect } from 'react'
import { View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
// Imported from each weight's own subpath, not from the package root: the root index
// re-exports all 18 Inter faces, and every one of them ends up in the bundle.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular'
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium'
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold'
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold'
import { AuthProvider, useAuth } from '@/auth/auth'
import { ComingSoonProvider } from '@/components/Dialogs'
import { createQueryClient } from '@/lib/queryClient'
import { ThemeProvider, useTheme } from '@/theme/theme'

// Keep the native splash up until the fonts are ready and the stored session has been
// checked, so the app never flashes the login screen at someone who is already signed in.
void SplashScreen.preventAutoHideAsync()

const queryClient = createQueryClient()

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  // A font that fails to download must not leave the driver on a blank screen: carry on with
  // the system font instead.
  const fontsReady = fontsLoaded || fontError !== null

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <ComingSoonProvider>
            <AuthProvider>
              <Root fontsReady={fontsReady} />
            </AuthProvider>
          </ComingSoonProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function Root({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth()
  const { colors, isDark } = useTheme()
  const router = useRouter()
  const segments = useSegments()

  const ready = fontsReady && status !== 'loading'

  const onLayout = useCallback(() => {
    if (ready) void SplashScreen.hideAsync()
  }, [ready])

  // A 401 can land at any moment (the token lasts 12 hours and there is no refresh), so if the
  // session goes away while the driver is inside the app, leave for the login screen.
  useEffect(() => {
    if (status !== 'signedOut') return
    const group = segments[0]
    if (group === '(driver)' || group === '(parent)' || group === 'unsupported' || group === 'set-password') {
      router.replace('/login')
    }
  }, [status, segments, router])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayout}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {ready ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="set-password" />
          <Stack.Screen name="unsupported" />
          <Stack.Screen name="(driver)" />
          <Stack.Screen name="(parent)" />
        </Stack>
      ) : null}
    </View>
  )
}
