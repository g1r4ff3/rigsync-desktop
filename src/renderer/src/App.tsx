import { useEffect, useState } from 'react'
import type { EngineStatus } from '../../shared/ipc'
import DiffView from './views/DiffView'
import SyncItemsView from './views/SyncItemsView'

type Tab = 'diff' | 'items'

function App(): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diff')

  useEffect(() => {
    window.api.engine
      .getStatus()
      .then(setStatus, (err: unknown) =>
        setStatusError(err instanceof Error ? err.message : String(err))
      )
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background p-6 text-foreground">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">rigsync</h1>
        {status ? (
          <>
            <p className="font-mono text-xs text-neutral-400">
              {status.machineId} · {status.role}
              {status.firstRun ? ' · dev default (온보딩 미완료)' : ''}
            </p>
            <p className="font-mono text-xs text-neutral-500">{status.manifestDir}</p>
          </>
        ) : statusError ? (
          <p className="font-mono text-xs text-red-400">error: {statusError}</p>
        ) : (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        )}
      </header>

      <nav className="mb-4 flex gap-1 border-b border-border">
        {(
          [
            { id: 'diff', label: 'Diff' },
            { id: 'items', label: '항목' }
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'border-b-2 px-3 py-1.5 font-mono text-xs ' +
              (tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-neutral-500 hover:text-neutral-300')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-hidden">
        {tab === 'diff' ? <DiffView status={status} /> : <SyncItemsView />}
      </main>
    </div>
  )
}

export default App
