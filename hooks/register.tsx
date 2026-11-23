import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ClawdIds } from '../types'

const PANE = 'agent-roster'
const STORE_KEY = 'ids'

// Bump the shape tag if this value's meaning changes later.
const ids = atom({ plugin: 'agent-roster', key: 'ids' } as const, {} as ClawdIds, {
  shape: 'ids-1',
})

type Agent = { name: string; description: string }

// A 22x13 pixel bitmap of Clawd the crab: round eyes on stalks, a domed
// shell, two pincer claws held out to the sides, and small legs peeking out
// underneath. '.' is transparent; the other letters key CLAWD_HEX / CLAWD_RGB
// below. Kept column-symmetric by construction.
const CLAWD_PIXELS: readonly string[] = [
  '.......WW....WW.......',
  '.......WKW..WKW.......',
  '..O....WW....WW....O..',
  'OOOO....D.OO.D....OOOO',
  'KKKKD..OOOOOOOO..DKKKK',
  '.OOODOOOOOOOOOOOODOOO.',
  '...DDOOOOOOOOOOOODD...',
  '.....OOOOOOOOOOOO.....',
  '.....OOOOOOOOOOOO.....',
  '.....DOOOOOOOOOOD.....',
  '...D....DDDDDD....D...',
  '...DD............DD...',
  '.DD................DD.',
]

const CLAWD_HEX: Readonly<Record<string, string>> = {
  O: '#ff9736',
  D: '#cc6a1e',
  K: '#1a1a1a',
  W: '#fff6ea',
}

const CLAWD_RGB: Readonly<Record<string, number>> = {
  O: 0xff9736,
  D: 0xcc6a1e,
  K: 0x1a1a1a,
  W: 0xfff6ea,
}

// Bounding boxes (in CLAWD_PIXELS coordinates) used to split the bitmap into
// independently animated groups: each claw pinches, the eyes blink, and
// everything else (shell + legs) rides along with a slow idle bob.
const CLAWD_CLAW_L = { x0: 0, x1: 4, y0: 2, y1: 7, pivot: '3.8px 5.6px' }
const CLAWD_CLAW_R = { x0: 17, x1: 21, y0: 2, y1: 7, pivot: '18.2px 5.6px' }
const CLAWD_EYES = { x0: 7, x1: 14, y0: 0, y1: 3, pivot: '11px 3px' }

function inBox(x: number, y: number, box: { x0: number; x1: number; y0: number; y1: number }): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
}

function clawdSvgSource(): string {
  const columns = CLAWD_PIXELS[0].length
  const rows = CLAWD_PIXELS.length
  const groups = { clawL: [] as string[], clawR: [] as string[], eyes: [] as string[], body: [] as string[] }

  CLAWD_PIXELS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]
      if (cell === '.') continue
      const rect = `<rect x="${x}" y="${y}" width="1" height="1" fill="${CLAWD_HEX[cell]}"/>`
      if (inBox(x, y, CLAWD_CLAW_L)) groups.clawL.push(rect)
      else if (inBox(x, y, CLAWD_CLAW_R)) groups.clawR.push(rect)
      else if (inBox(x, y, CLAWD_EYES)) groups.eyes.push(rect)
      else groups.body.push(rect)
    }
  })

  // Idle animation: a slow bob for the whole crab, an occasional blink, and
  // both claws giving a small periodic pinch (mirrored, slightly offset).
  const style = `.clawd-bob{animation:clawd-bob 2.6s ease-in-out infinite}` +
    `@keyframes clawd-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.6px)}}` +
    `.clawd-blink{animation:clawd-blink 4.8s ease-in-out infinite;transform-origin:${CLAWD_EYES.pivot}}` +
    `@keyframes clawd-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}` +
    `.clawd-claw-l{animation:clawd-pinch-l 3.4s ease-in-out infinite;transform-origin:${CLAWD_CLAW_L.pivot}}` +
    `.clawd-claw-r{animation:clawd-pinch-r 3.4s ease-in-out infinite .15s;transform-origin:${CLAWD_CLAW_R.pivot}}` +
    `@keyframes clawd-pinch-l{0%,75%,100%{transform:rotate(0)}85%{transform:rotate(-9deg)}}` +
    `@keyframes clawd-pinch-r{0%,75%,100%{transform:rotate(0)}85%{transform:rotate(9deg)}}`

  return (
    `<svg viewBox="0 0 ${columns} ${rows}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `<style>${style}</style>` +
    `<g class="clawd-bob">` +
    `<g>${groups.body.join('')}</g>` +
    `<g class="clawd-claw-l">${groups.clawL.join('')}</g>` +
    `<g class="clawd-claw-r">${groups.clawR.join('')}</g>` +
    `<g class="clawd-blink">${groups.eyes.join('')}</g>` +
    `</g>` +
    `</svg>`
  )
}

const CLAWD_SVG_SOURCE = clawdSvgSource()

// Packs the same bitmap into terminal cells two pixel-rows at a time (an
// upper/lower half-block per cell), since a character cell is about twice
// as tall as it is wide.
function clawdRasterCells(): { cells: string; columns: number; rows: number } {
  const SPACE = 0x20
  const FULL_BLOCK = 0x2588
  const UPPER_HALF = 0x2580
  const LOWER_HALF = 0x2584
  const DEFAULT = 0x01000000

  const columns = CLAWD_PIXELS[0].length
  const rows = Math.ceil(CLAWD_PIXELS.length / 2)
  const words: number[] = []

  for (let ty = 0; ty < rows; ty++) {
    const topRow = CLAWD_PIXELS[ty * 2]
    const bottomRow = CLAWD_PIXELS[ty * 2 + 1]

    for (let x = 0; x < columns; x++) {
      const topChar = topRow[x]
      const bottomChar = bottomRow ? bottomRow[x] : '.'
      const top = topChar === '.' ? undefined : CLAWD_RGB[topChar]
      const bottom = bottomChar === '.' ? undefined : CLAWD_RGB[bottomChar]

      let codePoint = SPACE
      let fg = DEFAULT
      let bg = DEFAULT

      if (top !== undefined && bottom !== undefined) {
        if (top === bottom) {
          codePoint = FULL_BLOCK
          fg = top
        } else {
          codePoint = UPPER_HALF
          fg = top
          bg = bottom
        }
      } else if (top !== undefined) {
        codePoint = UPPER_HALF
        fg = top
      } else if (bottom !== undefined) {
        codePoint = LOWER_HALF
        fg = bottom
      }

      words.push(codePoint, fg, bg)
    }
  }

  const bytes = new Uint8Array(Uint32Array.from(words).buffer)
  return { cells: bytes.toBase64(), columns, rows }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

function parseAgent(fileName: string, text: string): Agent | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return undefined
  const front = match[1]
  const nameMatch = front.match(/^name:\s*(.+)$/m)
  const descMatch = front.match(/^description:\s*(.+)$/m)
  const name = (nameMatch?.[1] ?? fileName.replace(/\.md$/, '')).trim()
  const description = (descMatch?.[1] ?? '').trim()
  return { name, description }
}

async function agentsDir($: any): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${home.replace(/\\/g, '/')}/.claude/agents`
}

async function loadAgents($: any): Promise<Agent[]> {
  const dir = await agentsDir($)
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
  const agents: Agent[] = []

  for (const file of files) {
    const text = await $.fs.read(`${dir}/${file.name}`).catch(() => undefined)
    if (text === undefined) continue
    const agent = parseAgent(file.name, text)
    if (agent) agents.push(agent)
  }

  agents.sort((a, b) => a.name.localeCompare(b.name))
  return agents
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-roster',
      description: 'Open the agent roster pane with Clawd identifiers',
    })
    await $.command.register({
      name: 'clawd-id',
      description: "Set or clear an agent's Clawd identifier",
      argumentHint: '<agent> [identifier]',
    })

    const stored = await $.store.get(STORE_KEY)
    if (stored && typeof stored === 'object') {
      await update($, ids, () => stored as ClawdIds)
    }

    void $.ui.open({ id: PANE, title: 'Agent Roster' })

    return next(e)
  })

  on('command.run', { command: 'agent-roster' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent Roster' })
    return { text: 'Agent roster pane opened.' }
  })

  on('command.run', { command: 'clawd-id' }, async ($, e) => {
    const args = e.args.trim()
    const spaceIndex = args.indexOf(' ')
    const agentName = (spaceIndex === -1 ? args : args.slice(0, spaceIndex)).trim()
    const identifier = spaceIndex === -1 ? '' : args.slice(spaceIndex + 1).trim()

    if (!agentName) {
      return {
        text: 'Usage: /clawd-id <agent> [identifier] (leave the identifier out to reset it).',
      }
    }

    const agents = await loadAgents($)
    if (!agents.some(agent => agent.name === agentName)) {
      return { text: `No agent named "${agentName}" found under ~/.claude/agents.` }
    }

    const updated = await update($, ids, map => {
      const copy = { ...map }
      if (identifier) copy[agentName] = identifier
      else delete copy[agentName]
      return copy
    })
    await $.store.set(STORE_KEY, updated)

    return {
      text: identifier
        ? `${agentName}'s Clawd identifier is now "${identifier}".`
        : `${agentName}'s Clawd identifier was reset to its default.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const resolved = $.ui.resolve(e)
    const { Box, Text, Button } = resolved as any
    const agents = await loadAgents($)

    const renderIcon = (keySuffix: string) => {
      if (e.surface === 'terminal') {
        const { Raster } = resolved as any
        const { cells, columns, rows } = clawdRasterCells()
        return (
          <Raster key={`clawd-icon-${keySuffix}`} columns={columns} rows={rows} cells={cells} />
        )
      }
      const { Svg } = resolved as any
      return (
        <Svg
          key={`clawd-icon-${keySuffix}`}
          source={CLAWD_SVG_SOURCE}
          alt="Clawd"
          width={40}
          height={24}
        />
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Clawd Agent Roster {'—'} {agents.length} agents</Text>
        <Text dimColor>Press edit, then type the new identifier and Enter.</Text>
        <Text> </Text>
        {agents.length === 0 && (
          <Text dimColor>No agents found under ~/.claude/agents.</Text>
        )}
        {agents.map(agent => {
          return (
            <Box flexDirection="column" key={agent.name}>
              <Box flexDirection="row">
                {renderIcon(agent.name)}
                <Text> </Text>
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Text bold>{agent.name}</Text>
                  </Box>
                  <Box flexDirection="row">
                    <Text dimColor>{truncate(agent.description, 72)} </Text>
                    <Button
                      key={`edit-${agent.name}`}
                      plain
                      label="edit"
                      onPress={() =>
                        $.prompt.fill({ text: `/clawd-id ${agent.name} `, mode: 'replace' })
                      }
                    />
                  </Box>
                </Box>
              </Box>
              <Text> </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
