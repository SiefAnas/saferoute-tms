import { useState, type ReactNode } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useColors } from '@/theme/theme'
import { Copyright } from './Copyright'

// Every tab screen: a scroll area on the page background, pull-to-refresh, and the design's
// thumb action bar pinned above the tab bar. The bar's real height is measured so the scroll
// content can never end up hidden underneath it.
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  thumbBar,
}: {
  children: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  thumbBar?: ReactNode
}) {
  const colors = useColors()
  const [barHeight, setBarHeight] = useState(0)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: barHeight + 24 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
          ) : undefined
        }
      >
        {children}
        <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: 16 }}>
          <Copyright />
        </View>
      </ScrollView>
      {thumbBar ? (
        <View
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 14,
            gap: 10,
          }}
        >
          {thumbBar}
        </View>
      ) : null}
    </View>
  )
}
