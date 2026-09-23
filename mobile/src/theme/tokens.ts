// Mobile design tokens (design 3a for the driver app, 5b for the parent app — both use the
// same palette). Values copied from the approved design handoff
// (design-reference/design_handoff_saferoute_refresh/README.md) and from the web app's
// `.mobile-app` CSS variables in client/src/index.css, so the two stay identical.

export interface Palette {
  bg: string
  surface: string
  surface2: string
  line: string
  divider: string
  outline: string
  outlineBg: string
  ink: string
  muted: string
  faint: string
  action: string
  onAction: string
  dangerInk: string
  scrim: string
  progress: string
  track: string
  avatar: string
  onAvatar: string
  segTrack: string
  segOn: string
  tabOn: string
  tabOff: string
  noteBg: string
  noteFg: string
  noteIcon: string
  callBg: string
  onCall: string
  calWorked: string
  onCalWorked: string
  calToday: string
  onCalToday: string
  calOff: string
  successBg: string
  successFg: string
  cautionBg: string
  cautionFg: string
  alertBg: string
  alertFg: string
  infoBg: string
  infoFg: string
  neutralBg: string
  neutralFg: string
  nextBg: string
  nextFg: string
}

export const light: Palette = {
  bg: '#fafafa',
  surface: '#ffffff',
  surface2: '#f4f4f6',
  line: '#e8e8ea',
  divider: '#f0f0f2',
  outline: '#e0e0e3',
  outlineBg: '#ffffff',
  ink: '#111318',
  muted: '#6b6f76',
  faint: '#9aa0a6',
  action: '#111318',
  onAction: '#ffffff',
  dangerInk: '#b42318',
  scrim: 'rgba(17, 19, 24, 0.38)',
  progress: '#111318',
  track: '#ececef',
  avatar: '#f4f4f6',
  onAvatar: '#111318',
  segTrack: '#efeff1',
  segOn: '#ffffff',
  tabOn: '#111318',
  tabOff: '#8a8f98',
  noteBg: '#fffaeb',
  noteFg: '#7a2e0e',
  noteIcon: '#b54708',
  callBg: '#111318',
  onCall: '#ffffff',
  calWorked: '#111318',
  onCalWorked: '#ffffff',
  calToday: '#f59e0b',
  onCalToday: '#111318',
  calOff: '#b0b4ba',
  successBg: '#ecfdf3',
  successFg: '#067647',
  cautionBg: '#fffaeb',
  cautionFg: '#b54708',
  alertBg: '#fef3f2',
  alertFg: '#b42318',
  infoBg: '#eff8ff',
  infoFg: '#175cd3',
  neutralBg: '#f2f4f7',
  neutralFg: '#475467',
  nextBg: '#111318',
  nextFg: '#ffffff',
}

export const dark: Palette = {
  bg: '#141a22',
  surface: '#1e2632',
  surface2: '#273140',
  line: '#2f3a48',
  divider: '#2a3441',
  outline: '#3a4656',
  outlineBg: '#1e2632',
  ink: '#eef1f5',
  muted: '#aab4c3',
  faint: '#6f7b8c',
  action: '#f59e0b',
  onAction: '#2a1700',
  dangerInk: '#ff9b91',
  scrim: 'rgba(0, 0, 0, 0.6)',
  progress: '#f59e0b',
  track: '#2f3a48',
  avatar: '#273140',
  onAvatar: '#eef1f5',
  segTrack: '#0f141b',
  segOn: '#273140',
  tabOn: '#ffb95f',
  tabOff: '#6f7b8c',
  noteBg: '#3d2a0a',
  noteFg: '#ffd9a6',
  noteIcon: '#ffb95f',
  callBg: '#f59e0b',
  onCall: '#2a1700',
  calWorked: '#f59e0b',
  onCalWorked: '#2a1700',
  calToday: '#eef1f5',
  onCalToday: '#141a22',
  calOff: '#56616f',
  successBg: '#123d2e',
  successFg: '#6ee7b7',
  cautionBg: '#3d2a0a',
  cautionFg: '#ffb95f',
  alertBg: '#3f1716',
  alertFg: '#ff9b91',
  infoBg: '#1f2a4a',
  infoFg: '#a9b8f5',
  neutralBg: '#273140',
  neutralFg: '#aab4c3',
  nextBg: '#f59e0b',
  nextFg: '#2a1700',
}

// Mobile radii from the handoff: cards 10, buttons 10, sheets 20 (top), pills 5.
export const radius = { card: 10, button: 10, sheet: 20, pill: 5, row: 8, circle: 999 } as const

// The 8px scale the rest of the product uses.
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 } as const

// Inter, the one mobile typeface. Weights loaded in app/_layout.tsx.
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const

export type ToneName = 'success' | 'caution' | 'alert' | 'info' | 'neutral' | 'next'

export function tone(p: Palette, name: ToneName): { bg: string; fg: string } {
  switch (name) {
    case 'success':
      return { bg: p.successBg, fg: p.successFg }
    case 'caution':
      return { bg: p.cautionBg, fg: p.cautionFg }
    case 'alert':
      return { bg: p.alertBg, fg: p.alertFg }
    case 'info':
      return { bg: p.infoBg, fg: p.infoFg }
    case 'next':
      return { bg: p.nextBg, fg: p.nextFg }
    case 'neutral':
      return { bg: p.neutralBg, fg: p.neutralFg }
  }
}
