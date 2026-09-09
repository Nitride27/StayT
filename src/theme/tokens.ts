// StayT Design Tokens
// Calm baseline + Duolingo gamification accents

export const colors = {
  // Core palette
  ectoGreen: '#58cc02',
  ectoGreenDark: '#46a302',
  ectoGreenLight: '#d7ffb8',
  lingotLime: '#a5ed6e',
  macawBlue: '#1cb0f6',
  macawBlueDark: '#1899d6',
  eelDarkBlue: '#042c60',
  midnight: '#000437',

  // Neutrals — light mode
  paper: '#f5f5f5',
  paperCard: '#ffffff',
  paperBorder: '#e5e5e5',
  ink: '#000437',
  inkSecondary: '#4b4b4b',
  inkMuted: '#777777',
  inkFaint: '#afafaf',

  // Gamification accents
  gold: '#ffc800',
  goldDark: '#e5b400',
  fire: '#ff9600',
  fireDark: '#e68600',
  danger: '#ff4b4b',
  dangerDark: '#ea2b2b',

  // Functional
  overlay: 'rgba(0, 4, 55, 0.6)',
  surfaceElevated: '#ffffff',
  permissionBanner: '#fff3cd',
  permissionBannerText: '#856404',
} as const;

export const darkColors = {
  paper: '#000437',
  paperCard: '#0a1a4a',
  paperBorder: '#1a2d5e',
  ink: '#f5f5f5',
  inkSecondary: '#c8c8c8',
  inkMuted: '#8e8e93',
  inkFaint: '#5a5a5e',
  overlay: 'rgba(0, 4, 55, 0.85)',
  surfaceElevated: '#0f2050',
  permissionBanner: '#2a2200',
  permissionBannerText: '#ffc107',
} as const;

export const typography = {
  // Display — streak numbers, big counters
  display: {
    fontSize: 40,
    fontWeight: '900' as const,
    letterSpacing: '-0.02em',
    lineHeight: 48,
  },
  // Heading — screen titles
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: '-0.01em',
    lineHeight: 34,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: '-0.01em',
    lineHeight: 28,
  },
  // Body
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.02,
    lineHeight: 22,
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.02,
    lineHeight: 22,
  },
  bodyBold: {
    fontSize: 16,
    fontWeight: '700' as const,
    letterSpacing: 0.02,
    lineHeight: 22,
  },
  // Label — buttons, chips
  label: {
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.04,
    lineHeight: 20,
  },
  // Caption
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    letterSpacing: 0.04,
    lineHeight: 18,
  },
  // Timer — big countdown
  timer: {
    fontSize: 64,
    fontWeight: '700' as const,
    letterSpacing: '-0.03em',
    lineHeight: 72,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

// Duolingo-style button tokens
export const buttons = {
  primary: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.md,
  },
  primaryPressed: {
    backgroundColor: colors.ectoGreenDark,
    borderBottomWidth: 1,
    borderBottomColor: colors.eelDarkBlue,
    marginTop: 2,
  },
  outlined: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.lingotLime,
    borderRadius: radius.md,
  },
  outlinedBlue: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.macawBlue,
    borderRadius: radius.md,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderRadius: radius.md,
  },
  danger: {
    backgroundColor: colors.danger,
    borderBottomWidth: 3,
    borderBottomColor: colors.dangerDark,
    borderRadius: radius.md,
  },
} as const;

// Gamification tokens (Duolingo-inspired)
export const gamification = {
  streak: {
    numberFont: {
      fontSize: 48,
      fontWeight: '900' as const,
      letterSpacing: '-0.02em',
    },
    fireSize: 32,
  },
  celebration: {
    confettiColors: [colors.ectoGreen, colors.lingotLime, colors.macawBlue, colors.gold],
  },
  blockedButton: {
    returnToTask: colors.ectoGreen,
    override: colors.macawBlue,
    switchTask: colors.lingotLime,
  },
} as const;

// Shadow — minimal, only for elevated cards
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
} as const;

// App-wide spacing patterns
export const layout = {
  screenPaddingH: spacing.xl,
  headerPaddingTop: 60,
  headerPaddingBottom: spacing.xl,
  safeAreaBottom: spacing.lg,
  cardPadding: spacing.lg,
  inputPadding: spacing.lg,
  sectionGap: spacing.xl,
} as const;
