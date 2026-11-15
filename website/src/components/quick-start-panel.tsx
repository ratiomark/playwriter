// Dashboard panel showing code snippets for getting started with cloud browsers.
// Uses holocron's CodeBlock for Prism syntax highlighting with copy button.
'use client'

import { useState } from 'react'
import { CodeBlock } from '@holocron.so/vite/mdx'

type Tab = 'cli' | 'mcp'

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function CliContent() {
  return (
    <div className="flex flex-col gap-5">
      <CodeBlock lang="bash" showLineNumbers={false} bleed="none">
        {`# Interactive login, then start a cloud browser and use it
playwriter cloud login
playwriter session new --browser cloud
playwriter -s 1 -e "state.page = await context.newPage(); await state.page.goto('https://example.com')"
playwriter -s 1 -e "console.log(await snapshot({ page: state.page }))"

# Or just set your API key and run directly
export PLAYWRITER_API_KEY=pw_xxxxx
playwriter session new --browser cloud --proxy us
playwriter -s 1 -e "state.page = await context.newPage(); await state.page.goto('https://example.com')"`}
      </CodeBlock>
    </div>
  )
}

function McpContent() {
  return (
    <div className="flex flex-col gap-5">
      <CodeBlock lang="json" showLineNumbers={false} bleed="none">
        {`{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["playwriter@latest", "mcp"],
      "env": {
        "PLAYWRITER_API_KEY": "pw_xxxxx"
      }
    }
  }
}`}
      </CodeBlock>
    </div>
  )
}

export function QuickStartPanel() {
  const [tab, setTab] = useState<Tab>('cli')

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border border-border bg-background p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">Quick Start</h2>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          <TabButton active={tab === 'cli'} onClick={() => { setTab('cli') }}>CLI</TabButton>
          <TabButton active={tab === 'mcp'} onClick={() => { setTab('mcp') }}>MCP</TabButton>
        </div>
      </div>

      {tab === 'cli' ? <CliContent /> : <McpContent />}
    </div>
  )
}
