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

  // R2: getStatus()를 마운트 시 1회만 부르면 Settings 저장 후에도 헤더(machineId·
  // role·manifestDir)와 이를 참조하는 다른 화면(Capture 비활성 사유 등)이 stale로
  // 남는다(실사용에서 발견된 버그 — role을 follower로 바꿔 저장해도 헤더가 계속
  // 이전 값을 보여줌). fetchStatus를 재사용 가능한 함수로 빼 SettingsView 저장
  // 콜백에서도 부른다 -- main의 ctx는 이미 refreshEngineContext()로 갱신되므로
  // 여기서 다시 조회하기만 하면 renderer 쪽 stale이 해소된다.
  function fetchStatus(): void {
    window.api.engine
      .getStatus()
      .then(setStatus, (err: unknown) =>
        setStatusError(err instanceof Error ? err.message : String(err))
      )
  }

  useEffect(() => {
    fetchStatus()
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
      {/* R1b 원칙③(정보 밀도): identity 블록을 한 줄로 압축한다 — 이전에는
          제목/machineId·role/manifestDir가 각각 줄을 차지해 화면 상단 1/3을
          먹었다. 경로는 화면 폭을 넘기면 잘리고 title로 전문을 제공한다. */}
      <header className="mb-2 flex items-center gap-2 border-b border-border pb-2">
        <span className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
          rigsync
        </span>
        {status ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">
              {status.machineId} · {status.role}
            </span>
            {syncKind && (
              <>
                <span className="shrink-0">·</span>
                <StatusText kind={syncKind} className="inline-flex shrink-0">
                  {syncStatusLabel(syncStatus)}
                </StatusText>
              </>
            )}
            <span className="shrink-0">·</span>
            <span className="min-w-0 truncate font-mono text-[11px]" title={status.manifestDir}>
              {status.manifestDir}
            </span>
          </div>
        ) : statusError ? (
          <StatusText kind="error">{statusError}</StatusText>
        ) : (
          <p className="text-xs text-muted-foreground">로딩 중…</p>
        )}
      </header>

      <nav className="mb-3 flex gap-1 border-b border-border">
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
          <SettingsView onSaved={fetchStatus} />
        )}
      </main>
    </div>
  )
}

export default App
