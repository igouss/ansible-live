import type { Elements, RenderElement, TextProps } from 'claude-code'
import type { Line, Span, Tone, View } from '../core/view.ts'

/** The elements every surface has, which is all the pane draws with. */
export type Drawing = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the pane's buttons do. */
export type Moves = { readonly older: () => void; readonly newer: () => void; readonly live: () => void; readonly close: () => void }

const TONES: { readonly [T in Tone]: TextProps } = {
  plain: {},
  dim: { dimColor: true },
  bold: { bold: true },
  notice: { color: 'yellow' },
  running: { color: 'cyan' },
  ok: { color: 'green' },
  changed: { color: 'yellow' },
  failed: { color: 'red' },
  ignored: { color: 'red', dimColor: true },
  unreachable: { color: 'magenta' },
  skipped: { dimColor: true },
}

export function pane({ Box, Text, Button }: Drawing, seen: View, moves: Moves): RenderElement {
  const row = (key: string, line: Line): RenderElement => (
    <Box key={key}>
      <Text wrap="truncate">{line.map((span: Span) => <Text {...TONES[span.tone]}>{span.text}</Text>)}</Text>
    </Box>
  )
  const rows = (key: string, lines: readonly Line[]): RenderElement[] => lines.map((line: Line, at: number) => row(`${key}.${at}`, line))
  const optional = (key: string, line: Line | null): RenderElement[] => (line === null ? [] : [row(key, line)])
  /** Lines set apart from what is above them, when there are any. */
  const section = (key: string, lines: readonly Line[]): RenderElement[] => (lines.length === 0 ? [] : [
    <Box key={key} flexDirection="column" marginTop={1}>{rows(key, lines)}</Box>,
  ])
  return (
    <Box flexDirection="column">
      {row('head', seen.head)}
      {optional('where', seen.where)}
      {optional('now', seen.now)}
      {section('grid', seen.grid)}
      {optional('legend', seen.legend)}
      {optional('totals', seen.totals)}
      {section('failure', seen.failure)}
      {section('notes', seen.notes)}
      {seen.place === null ? [] : [
        <Box key="moves" flexDirection="row" gap={1} marginTop={1}>
          <Button key="older" hotkey="o" onPress={moves.older}>older</Button>
          <Button key="newer" hotkey="n" onPress={moves.newer}>newer</Button>
          <Button key="live" hotkey="l" onPress={moves.live}>live</Button>
          {row('place', seen.place)}
        </Box>,
      ]}
      <Box key="end" marginTop={1}>
        <Button key="close" hotkey="q" role="dismiss" onPress={moves.close}>close</Button>
      </Box>
    </Box>
  )
}
