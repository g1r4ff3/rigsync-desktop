import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { tabCopy } from './copy'
import { SCREENSHOT_GOTO_EVENT } from './screenshotBus'
import { StatusText } from './status'
import { syncStatusKind } from './statusKind'
import type { EngineStatus, ScreenshotRoute, SyncStatusDto } from '../../shared/ipc'
import DiffView from './views/DiffView'
import DoctorView from './views/DoctorView'
import OnboardingView from './views/OnboardingView'
import SettingsView from './views/SettingsView'
import SyncItemsView from './views/SyncItemsView'

type Tab = 'diff' | 'items' | 'doctor' | 'settings'

function syncStatusLabel(status: SyncStatusDto | null): string {
  if (!status) return ''
  if (status.kind === 'local-only') return '로컬 전용'
  if (status.kind === 'synced') return '동기화됨'
  if (status.kind === 'behind') return `뒤처짐 (${status.behindBy})`
  return `오류: ${status.message}`
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diff')
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null)
  // R4: 스크린샷 하네스가 firstRun과 무관하게 온보딩 화면을 강제로 띄울 때만 true.
  const [forceOnboarding, setForceOnboarding] = useState(false)

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

  // R4: 스크린샷 하네스 -- main이 지시한 화면으로 강제 전환한다. 'apply-dialog'는
  // DiffView 내부 상태라 window CustomEvent로 다시 뿌려 DiffView가 직접 듣는다.
  // **주의**: setTab('diff')로 DiffView를 막 마운트했다면 그 리스너가
  // useEffect로 붙기까지 한 렌더 사이클이 필요하다 — 같은 틱에서 바로
  // dispatchEvent하면 DiffView가 아직 구독 전이라 이벤트를 놓친다(실기
  // 스크린샷에서 실제로 발견 -- Apply 다이얼로그가 하나도 안 열렸었다).
  // setTimeout으로 한 틱 미뤄 마운트를 보장한다.
  useEffect(() => {
    return window.api.engine.onScreenshotGoto((route: ScreenshotRoute) => {
      if (route === 'onboarding') {
        setForceOnboarding(true)
        return
      }
      setForceOnboarding(false)
      if (route === 'apply-dialog') {
        setTab('diff')
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(SCREENSHOT_GOTO_EVENT, { detail: route }))
        }, 300)
        return
      }
      setTab(route)
    })
  }, [])

  if (status?.firstRun || forceOnboarding) {
    return (
      <div className="min-h-screen bg-background px-6 text-foreground">
        <OnboardingView
          status={
            status ?? {
              machineId: '',
              role: 'reference',
              manifestDir: '',
              firstRun: true,
              autostartEnabled: false
            }
          }
          onComplete={(s) => {
            setForceOnboarding(false)
            setStatus(s)
          }}
        />
      </div>
    )
  }

  const syncKind = syncStatus ? syncStatusKind(syncStatus.kind) : null

  return (
    <div className="flex min-h-screen flex-col bg-background p-6 text-foreground">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">rigsync</h1>
        {status ? (
          <>
            <p className="text-xs text-muted-foreground">
              {status.machineId} · {status.role}
              {syncKind && (
                <>
                  {' · '}
                  <StatusText kind={syncKind} className="inline-flex">
                    {syncStatusLabel(syncStatus)}
                  </StatusText>
                </>
              )}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{status.manifestDir}</p>
          </>
        ) : statusError ? (
          <StatusText kind="error">{statusError}</StatusText>
        ) : (
          <p className="text-xs text-muted-foreground">로딩 중…</p>
        )}
      </header>

      <nav className="mb-4 flex gap-1 border-b border-border">
        {(['diff', 'items', 'doctor', 'settings'] as const).map((id) => {
          const t = tabCopy[id]
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTab(id)}
                  className={
                    'border-b-2 px-3 py-1.5 text-xs font-medium ' +
                    (tab === id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground')
                  }
                >
                  {t.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t.subtitle}</TooltipContent>
            </Tooltip>
          )
        })}
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
