import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ClawdIds } from '../types'

const PANE = 'agent-roster'
const STORE_KEY = 'ids'

// Bump the shape tag if this value's meaning changes later.
const ids = atom({ plugin: 'agent-roster', key: 'ids' } as const, {} as ClawdIds, {
  shape: 'ids-1',
})

type Agent = { name: string; description: string }

// A 16x12 pixel bitmap of Clawd, in orange: eye stalks, a shell, pincer
// claws and legs. '.' is transparent; the other letters key CLAWD_HEX /
// CLAWD_RGB below. Kept column-symmetric by construction.
const CLAWD_PIXELS: readonly string[] = [
  '...DD......DD...',
  '...KK......KK...',
  '....OOOOOOOO....',
  '..OOOOOOOOOOOO..',
  'DDOOOKKOOKKOOODD',
  'DDDOOOOOOOOOODDD',
  'D.DOOOOOOOOOOD.D',
  'DDOOOOOOOOOOOODD',
  'D.OOOOOOOOOOOO.D',
  '..DDOOOOOOOODD..',
  'DD............DD',
  '.DD..........DD.',
]

const CLAWD_HEX: Readonly<Record<string, string>> = {
  O: '#ff9736',
  D: '#cc6a1e',
  K: '#1a1a1a',
}

const CLAWD_RGB: Readonly<Record<string, number>> = {
  O: 0xff9736,
  D: 0xcc6a1e,
  K: 0x1a1a1a,
}

function clawdSvgSource(): string {
  const columns = CLAWD_PIXELS[0].length
  const rows = CLAWD_PIXELS.length
  const rects: string[] = []

  CLAWD_PIXELS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]
      if (cell === '.') continue
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${CLAWD_HEX[cell]}"/>`)
    }
  })

  return (
    `<svg viewBox="0 0 ${columns} ${rows}" xmlns="http://www.w3.org/2000/svg" ` +
    `shape-rendering="crispEdges">${rects.join('')}</svg>`
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

function autoId(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return 'CLAWD-' + hash.toString(36).toUpperCase().padStart(4, '0').slice(-4)
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
    const customIds = await read($, ids)

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
          width={32}
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
          const clawdId = customIds[agent.name] ?? autoId(agent.name)
          return (
            <Box flexDirection="column" key={agent.name}>
              <Box flexDirection="row">
                {renderIcon(agent.name)}
                <Text> </Text>
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Text bold color="cyan">
                      [{clawdId}]{' '}
                    </Text>
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
