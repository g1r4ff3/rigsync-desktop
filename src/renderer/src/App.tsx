import { useEffect, useState } from 'react'
import type { EngineStatus, SyncStatusDto } from '../../shared/ipc'
import DiffView from './views/DiffView'
import DoctorView from './views/DoctorView'
import OnboardingView from './views/OnboardingView'
import SettingsView from './views/SettingsView'
import SyncItemsView from './views/SyncItemsView'

type Tab = 'diff' | 'items' | 'doctor' | 'settings'

function syncStatusLabel(status: SyncStatusDto | null): { text: string; className: string } {
  if (!status) return { text: '', className: 'text-neutral-600' }
  if (status.kind === 'local-only') return { text: '로컬 전용', className: 'text-neutral-500' }
  if (status.kind === 'synced') return { text: '동기화됨', className: 'text-green-400' }
  if (status.kind === 'behind') {
    return { text: `뒤처짐 (${status.behindBy})`, className: 'text-amber-400' }
  }
  return { text: `오류: ${status.message}`, className: 'text-red-400' }
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diff')
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null)

  useEffect(() => {
    window.api.engine
      .getStatus()
      .then(setStatus, (err: unknown) =>
        setStatusError(err instanceof Error ? err.message : String(err))
      )
  }, [])

  // P4: 상태바의 git 전송 상태(동기화됨/뒤처짐/로컬 전용/오류) — 부작용 없는
  // 조회라 탭 전환과 무관하게 주기적으로 다시 물어도 안전하다.
  useEffect(() => {
    if (!status || status.firstRun) return
    let cancelled = false
    const refresh = (): void => {
      window.api.engine.getSyncStatus().then((s) => {
        if (!cancelled) setSyncStatus(s)
      }, console.error)
    }
    refresh()
    const interval = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [status])

  // P3: 트레이 알림 클릭 -> main이 창을 보여준 뒤 이 push로 Diff 탭을 연다.
  useEffect(() => {
    return window.api.engine.onFocusDiffTab(() => setTab('diff'))
  }, [])

  if (status?.firstRun) {
    return (
      <div className="min-h-screen bg-background px-6 text-foreground">
        <OnboardingView status={status} onComplete={setStatus} />
      </div>
    )
  }

  const sync = syncStatusLabel(syncStatus)

  return (
    <div className="flex min-h-screen flex-col bg-background p-6 text-foreground">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">rigsync</h1>
        {status ? (
          <>
            <p className="font-mono text-xs text-neutral-400">
              {status.machineId} · {status.role}
              {sync.text && (
                <>
                  {' · '}
                  <span className={sync.className}>{sync.text}</span>
                </>
              )}
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
            { id: 'diff', label: 'Differences' },
            { id: 'items', label: 'Candidates' },
            { id: 'doctor', label: 'Doctor' },
            { id: 'settings', label: 'Settings' }
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
        {tab === 'diff' ? (
          <DiffView status={status} />
        ) : tab === 'items' ? (
          <SyncItemsView />
        ) : tab === 'doctor' ? (
          <DoctorView />
        ) : (
          <SettingsView />
        )}
      </main>
    </div>
  )
}

export default App
