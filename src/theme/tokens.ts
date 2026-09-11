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
  paper: '#000000',
  paperCard: '#111111',
  paperBorder: '#222222',
  ink: '#ffffff',
  inkSecondary: '#c8c8c8',
  inkMuted: '#888888',
  inkFaint: '#555555',
  overlay: 'rgba(0, 0, 0, 0.85)',
  surfaceElevated: '#111111',
  permissionBanner: '#2a2200',
  permissionBannerText: '#ffc107',
} as const;

export type Colors = typeof colors;

export const typography = {
  // ─── Anton — brutalist personality, big moments only ───
  displayXL: {
    fontFamily: 'Anton',
    fontSize: 72,
    letterSpacing: -0.04,
    lineHeight: 65, // 0.9
  },
  display: {
    fontFamily: 'Anton',
    fontSize: 48,
    letterSpacing: -0.03,
    lineHeight: 43, // 0.9
  },

  // ─── SpaceGrotesk — UI + headings ───
  h1: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 32,
    letterSpacing: -0.03,
    lineHeight: 36,
  },
  h2: {
    fontFamily: 'SpaceGrotesk-SemiBold',
    fontSize: 24,
    letterSpacing: -0.02,
    lineHeight: 28,
  },
  h3: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 18,
    letterSpacing: -0.01,
    lineHeight: 22,
  },
  button: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 17,
    letterSpacing: 0.02,
    lineHeight: 22,
  },
  label: {
    fontFamily: 'SpaceGrotesk-Medium',
    fontSize: 12,
    letterSpacing: 0.04,
    lineHeight: 16,
  },
  timer: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 48,
    letterSpacing: -0.02,
    lineHeight: 53, // 0.9
  },
  timerXL: {
    fontFamily: 'Anton',
    fontSize: 72,
    letterSpacing: -0.02,
    lineHeight: 79,
  },

  // ─── Inter — readability, longer text ───
  body: {
    fontFamily: 'Inter-Regular',
    fontSize: 16,
    letterSpacing: 0,
    lineHeight: 22, // 1.4
  },
  bodyMedium: {
    fontFamily: 'SpaceGrotesk-Medium',
    fontSize: 16,
    letterSpacing: 0,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 17,
    letterSpacing: 0,
    lineHeight: 24,
  },
  // Alias for screens still using bodyBold
  bodyBold: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 17,
    letterSpacing: 0,
    lineHeight: 24,
  },
  caption: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    letterSpacing: 0.02,
    lineHeight: 18,
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
// Button chrome may use ONLY ectoGreen/ectoGreenDark (+midnight text) and danger red.
export const buttons = {
  primary: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
  },
  primaryPressed: {
    backgroundColor: colors.ectoGreenDark,
    borderBottomWidth: 1,
    borderBottomColor: colors.ectoGreenDark,
    marginTop: 2,
  },
  outlined: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.ectoGreen,
    borderRadius: radius.xl,
  },
  outlinedBlue: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.ectoGreen,
    borderRadius: radius.xl,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderRadius: radius.xl,
  },
  danger: {
    backgroundColor: colors.danger,
    borderBottomWidth: 3,
    borderBottomColor: colors.dangerDark,
    borderRadius: radius.xl,
  },
} as const;

// Gamification tokens (Duolingo-inspired)
export const gamification = {
  streak: {
    numberFont: {
      fontFamily: 'Anton',
      fontSize: 48,
      letterSpacing: -0.03,
    },
    fireSize: 32,
  },
  celebration: {
    confettiColors: [colors.ectoGreen, colors.lingotLime, colors.macawBlue, colors.gold],
  },
  blockedButton: {
    returnToTask: colors.ectoGreen,
    override: colors.ectoGreen,
    switchTask: colors.ectoGreen,
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
