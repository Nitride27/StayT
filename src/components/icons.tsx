// StayT SVG icon family — detailed OUTLINE line glyphs app-wide (FlameIcon is fill-based).
// Task glyphs (Laptop/Pen/Book/Bolt) are outline style per the mockup's
// line glyphs: 2.6 weight with detail strokes (screen+base, body+ferrule,
// open book+spine, bolt). Everything else stays stroke style.
// react-native-svg 15.15.4, 24 viewBox, strokeWidth 2.6 default
// (mockup glyphs are chunky/rounded, ~2.5-3px at 24 viewBox),
// round caps/joins throughout. Same props API on every export
// ({ size, color }) so call sites keep working.
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

function Base({
  size = 24,
  color = '#000',
  strokeWidth = 2.6,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

function Solid({
  size = 24,
  color = '#000',
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {children}
    </Svg>
  );
}

export function LaptopIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Rect x={3} y={4} width={18} height={12} rx={2} />
      <Path d="M2 20h20" />
    </Base>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M17 3l4 4L8 20l-5 1 1-5L17 3z" />
      <Path d="M15 5l4 4" />
    </Base>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z" />
      <Path d="M12 6v14" />
    </Base>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </Base>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
    </Base>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M14.5 5.5L8 12l6.5 6.5" />
    </Base>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M20 6 9 17l-5-5" />
    </Base>
  );
}

export function SwitchArrowsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="m17 1 4 4-4 4" />
      <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <Path d="m7 23-4-4 4-4" />
      <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M12 5v14" />
      <Path d="M5 12h14" />
    </Base>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M18 6 6 18" />
      <Path d="m6 6 12 12" />
    </Base>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3.5 2" />
    </Base>
  );
}

// Streak flame — mockup's Duo-style blobby mark as vector. Two subpaths,
// no stroke: outer silhouette in `color`, inner teardrop knocked out via
// evenodd so the pill/card background shows through (reads at 18px pill
// and 48px History; silhouette deliberately simplified to ~7 curves so
// the small size stays legible instead of muddy).
const FLAME_OUTER =
  'M12 2.6C10.9 5.1 9.3 6.9 7.4 8.8C4.9 11.2 3.6 13.4 3.6 16.1' +
  'C3.6 20.5 7.4 23.6 12 23.6C16.6 23.6 20.4 20.5 20.4 16.1' +
  'C20.4 13.3 19.1 11.1 17.2 9.4C16.8 9 16.2 9.2 16.1 9.8' +
  'C15.8 11.1 15.4 12.3 14.7 13.3C15.2 10.4 14.6 6.7 12 2.6Z';
const FLAME_INNER =
  'M12 12.9C11 14.3 9.4 15.7 9.4 17.7C9.4 19.7 10.7 21.1 12 21.1' +
  'C13.3 21.1 14.6 19.7 14.6 17.7C14.6 15.7 13 14.3 12 12.9Z';

export function FlameIcon({ size = 24, color = '#58cc02' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={`${FLAME_OUTER} ${FLAME_INNER}`}
        fill={color}
        fillRule="evenodd"
        stroke="none"
      />
    </Svg>
  );
}

// Task name → glyph mapping (shared by TaskPicker cards + TaskSetup context).
// writ/pen/journal → Pen, stud/book/read/school → Book,
// work/job/code/meet/laptop → Laptop, else Bolt.
export type TaskIconName = 'pen' | 'book' | 'laptop' | 'bolt';

export function taskIconForName(name: string): TaskIconName {
  const n = (name || '').toLowerCase();
  if (n.includes('writ') || n.includes('pen') || n.includes('journal')) return 'pen';
  if (n.includes('stud') || n.includes('book') || n.includes('read') || n.includes('school'))
    return 'book';
  if (
    n.includes('work') ||
    n.includes('job') ||
    n.includes('code') ||
    n.includes('meet') ||
    n.includes('laptop')
  )
    return 'laptop';
  return 'bolt';
}

export function TaskGlyph({
  name,
  size = 22,
  color = '#000437',
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const kind = taskIconForName(name);
  if (kind === 'pen') return <PenIcon size={size} color={color} />;
  if (kind === 'book') return <BookIcon size={size} color={color} />;
  if (kind === 'laptop') return <LaptopIcon size={size} color={color} />;
  return <BoltIcon size={size} color={color} />;
}
