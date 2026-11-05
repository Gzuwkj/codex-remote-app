import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';

export const palette = (dark: boolean) =>
  dark
    ? {
        bg: '#171717',
        surface: '#212121',
        soft: '#2f2f2f',
        text: '#f5f5f5',
        muted: '#a0a0a0',
        line: '#383838',
        button: '#f5f5f5',
        buttonText: '#171717',
        danger: '#f38a85',
        code: '#222222',
      }
    : {
        bg: '#ffffff',
        surface: '#f9f9f9',
        soft: '#f0f0f0',
        text: '#171717',
        muted: '#787878',
        line: '#e8e8e8',
        button: '#171717',
        buttonText: '#ffffff',
        danger: '#b93e38',
        code: '#f6f6f6',
      };
export type Colors = ReturnType<typeof palette>;
export type IconName =
  | 'menu'
  | 'new'
  | 'back'
  | 'close'
  | 'more'
  | 'down'
  | 'up'
  | 'plus'
  | 'stop'
  | 'search'
  | 'folder'
  | 'monitor'
  | 'copy'
  | 'check'
  | 'refresh'
  | 'clock'
  | 'arrowDown'
  | 'chevron'
  | 'trash'
  | 'terminal'
  | 'file'
  | 'image'
  | 'settings';
export function Icon({
  name,
  size = 22,
  color = '#171717',
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const shapes: Record<IconName, React.ReactNode> = {
    menu: (
      <>
        <Line x1="4" y1="7" x2="20" y2="7" />
        <Line x1="4" y1="12" x2="16" y2="12" />
        <Line x1="4" y1="17" x2="20" y2="17" />
      </>
    ),
    new: (
      <>
        <Path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
        <Path d="m14 4 3-3 4 4-3 3-8 8-4 1 1-4Z" />
      </>
    ),
    back: <Path d="m14 5-7 7 7 7" />,
    close: (
      <>
        <Path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    more: (
      <>
        <Circle cx="5" cy="12" r="1" fill={color} />
        <Circle cx="12" cy="12" r="1" fill={color} />
        <Circle cx="19" cy="12" r="1" fill={color} />
      </>
    ),
    down: <Path d="m7 10 5 5 5-5" />,
    up: <Path d="M12 19V5m-6 6 6-6 6 6" />,
    plus: <Path d="M12 5v14M5 12h14" />,
    stop: (
      <Rect
        x="6.5"
        y="6.5"
        width="11"
        height="11"
        rx="1.5"
        fill={color}
        strokeWidth="0"
      />
    ),
    search: (
      <>
        <Circle cx="10.5" cy="10.5" r="6.5" />
        <Path d="m16 16 4 4" />
      </>
    ),
    folder: (
      <Path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
    ),
    monitor: (
      <>
        <Rect x="3" y="4" width="18" height="13" rx="2" />
        <Path d="M12 17v4m-4 0h8" />
      </>
    ),
    copy: (
      <>
        <Rect x="8" y="8" width="12" height="13" rx="2" />
        <Path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
      </>
    ),
    check: <Path d="m5 12 4 4L19 6" />,
    refresh: (
      <>
        <Path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
      </>
    ),
    clock: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 7v5l3 2" />
      </>
    ),
    arrowDown: <Path d="M12 4v16m-6-6 6 6 6-6" />,
    chevron: <Path d="m9 5 7 7-7 7" />,
    trash: (
      <>
        <Path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
      </>
    ),
    terminal: (
      <>
        <Rect x="3" y="4" width="18" height="16" rx="3" />
        <Path d="m7 9 3 3-3 3m6 0h4" />
      </>
    ),
    file: (
      <>
        <Path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
        <Path d="M14 3v6h5M8 14h8m-8 3h6" />
      </>
    ),
    image: (
      <>
        <Rect x="3" y="3" width="18" height="18" rx="3" />
        <Circle cx="8" cy="8" r="1.5" />
        <Path d="m3 17 6-6 4 4 3-3 5 5" />
      </>
    ),
    settings: (
      <>
        <Path d="m10 3 4 0 1 3 3 1 3 2-2 3 0 4-3 1-2 4-4-1-2-3-4-1 0-4-2-3 3-2 3-1Z" />
        <Circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name]}
    </Svg>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  colors,
  disabled = false,
  size = 22,
  filled = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  colors: Colors;
  disabled?: boolean;
  size?: number;
  filled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        ui.iconButton,
        {
          backgroundColor: filled
            ? colors.button
            : pressed
            ? colors.soft
            : 'transparent',
          opacity: disabled ? 0.3 : pressed ? 0.65 : 1,
        },
      ]}
    >
      <Icon
        name={name}
        size={size}
        color={filled ? colors.buttonText : colors.text}
      />
    </Pressable>
  );
}
export function Pill({
  children,
  colors,
  onPress,
  label,
}: {
  children: React.ReactNode;
  colors: Colors;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[ui.pill, { borderColor: colors.line }]}
    >
      {children}
    </Pressable>
  );
}
export const ui = StyleSheet.create({
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 24,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  muted: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 15, lineHeight: 22 },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 54,
    paddingHorizontal: 8,
  },
});
