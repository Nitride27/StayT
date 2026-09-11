// StayT SVG icon family — one stroke style app-wide.
// react-native-svg 15.15.4, 24 viewBox, strokeWidth 2, stroke=currentColor-ish via `color` prop.
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
  strokeWidth = 2,
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
      <Path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </Base>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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
      <Path d="m9 18 6-6-6-6" />
    </Base>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="m15 18-6-6 6-6" />
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
