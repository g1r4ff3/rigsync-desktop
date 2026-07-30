import { useEffect, useState } from 'react'
import { HelpPopover } from '@/components/HelpPopover'
import { TitleBar } from '@/components/TitleBar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { helpCopy, tabCopy } from './copy'
import { diffSnapshotSlot, fetchDiffSnapshot } from './diffSnapshotStore'
import { doctorSnapshotSlot, fetchDoctorSnapshot } from './doctorSnapshotStore'
import { SCREENSHOT_GOTO_EVENT } from './screenshotBus'
import { syncStatusKind } from './statusKind'
import { fetchSyncItemsSnapshot, syncItemsSnapshotSlot } from './syncItemsSnapshotStore'
import type {
  EngineStatus,
  ManifestSourceMode,
  ScreenshotRoute,
  SyncStatusDto
} from '../../shared/ipc'
import DiffView from './views/DiffView'
import DoctorView from './views/DoctorView'
import OnboardingView from './views/OnboardingView'
import SettingsView from './views/SettingsView'
import SyncItemsView from './views/SyncItemsView'

type Tab = 'diff' | 'items' | 'doctor' | 'settings'

function App(): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diff')
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null)
  // R4: 스크린샷 하네스가 firstRun과 무관하게 온보딩 화면을 강제로 띄울 때만 true.
  const [forceOnboarding, setForceOnboarding] = useState(false)
  // R4: 'onboarding-clone' route 전용 -- 클론 탭이 미리 선택된 온보딩 화면을 캡처하려고
  // OnboardingView의 initialManifestSource를 강제한다(스크린샷 하네스 전용, 평상시 미사용).
  const [onboardingPreset, setOnboardingPreset] = useState<ManifestSourceMode | undefined>()
  // WS7("창고 모델 1차"): 온보딩에서 "선택 구독"을 고르고 완료하면 SyncItems가
  // 첫 방문 안내(그룹 체크박스·구독 Switch가 곧 피커)를 한 번 보여준다 —
  // 새로고침이나 다른 세션까지 남길 필요는 없어 메모리 상태로 충분하다.
  const [showSelectionOnboardingHint, setShowSelectionOnboardingHint] = useState(false)

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

  // 4단계(스냅샷 스토어): 세 스토어(diff·syncItems·doctor)를 status가 준비되는
  // 즉시 백그라운드로 채워둔다 — 그래야 사용자가 아직 방문 안 한 탭으로
  // 전환해도 "탭 전환 체감 0ms"가 성립한다(안 그러면 diff 탭만 자동
  // 프리페치되고 items·doctor는 첫 방문 때 여전히 스켈레톤을 본다). 3개 모두
  // read 전용이라 동시 실행 안전(2단계 워커 스케줄러가 이미 보장) + 병렬로
  // 쏘는 게 순차보다 빠르다(1단계 실측 — 기동 시나리오 참조).
  useEffect(() => {
    if (!status || status.firstRun) return
    diffSnapshotSlot.revalidate(() => fetchDiffSnapshot(status)).catch(() => {})
    syncItemsSnapshotSlot.revalidate(fetchSyncItemsSnapshot).catch(() => {})
    doctorSnapshotSlot.revalidate(fetchDoctorSnapshot).catch(() => {})
  }, [status])

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
  // 4단계: 이미 Diff 탭이 활성 상태였다면 setTab('diff')는 no-op이라
  // DiffView가 리마운트되지 않고, 마운트 효과로 걸려 있던 자동 재검증도
  // 트리거되지 않는다 — 백그라운드 drift 체크가 뭔가를 발견해 알림까지 왔는데
  // 스토어는 그걸 모르는 상태로 남는 셈이다. diffSnapshotSlot을 직접
  // revalidate해 스케줄러가 찾아낸 변화가 항상 스토어로 흘러들게 한다.
  useEffect(() => {
    return window.api.engine.onFocusDiffTab(() => {
      setTab('diff')
      void diffSnapshotSlot.revalidate(() => fetchDiffSnapshot(status))
    })
  }, [status])

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
        setOnboardingPreset(undefined)
        setForceOnboarding(true)
        return
      }
      if (route === 'onboarding-clone') {
        setOnboardingPreset('clone')
        setForceOnboarding(true)
        return
      }
      setForceOnboarding(false)
      if (
        route === 'apply-dialog' ||
        route === 'items-delete-confirm' ||
        route === 'items-bulk-delete' ||
        route === 'items-distro' ||
        route === 'items-distro-open' ||
        route === 'items-register-dotfile'
      ) {
        setTab(route === 'apply-dialog' ? 'diff' : 'items')
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(SCREENSHOT_GOTO_EVENT, { detail: route }))
        }, 300)
        return
      }
      setTab(route)
    })
  }, [])

  const syncKind = syncStatus ? syncStatusKind(syncStatus.kind) : null
  const isOnboarding = status?.firstRun || forceOnboarding

  // UI 정돈(v0.1.16): frame:false라 TitleBar가 유일한 창 이동/제어 수단이다 —
  // 온보딩 화면에서도 예외 없이 항상 렌더한다. 온보딩 중엔 machineId·role이
  // 아직 확정 전이라 status가 있어도 identity 블록은 "로딩 중…"처럼 보일 수
  // 있는데, TitleBar는 status===null일 때만 "로딩 중…"을 보여주므로 firstRun
  // 상태의 placeholder status(위 OnboardingView status prop과 동일한 값)를
  // 그대로 넘긴다 — machineId가 빈 문자열이라도 창 제어 버튼은 항상 동작한다.
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        status={isOnboarding ? null : status}
        statusError={statusError}
        syncStatus={syncStatus}
        syncKind={syncKind}
      />
      {isOnboarding ? (
        <div className="flex-1 overflow-y-auto px-6">
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
            onComplete={(s, selectionMode) => {
              setForceOnboarding(false)
              setStatus(s)
              // WS7: select면 Candidates 탭에 착지 + 첫 방문 안내(그룹
              // 체크박스·구독 Switch가 곧 피커라는 안내 한 줄, 계획서 지시).
              if (selectionMode === 'select') {
                setTab('items')
                setShowSelectionOnboardingHint(true)
              }
            }}
            initialManifestSource={onboardingPreset}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden p-6 pt-3">
          {/* R4-2 #2: "?" 헬프는 화면마다 제각각 떠 있던 걸(Settings·Candidates에선
              좌측에 홀로) 탭 바 우측 끝 한 자리로 통일한다 — 위치·형태가 전 화면에서
              항상 같아야 "여기 누르면 된다"가 학습된다(일관성 원칙). 화면별 텍스트는
              그대로 helpCopy[tab]에서 가져오므로 각 화면 고유 설명은 유지된다. */}
          <nav className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-border">
            <div className="flex gap-1">
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
            </div>
            <HelpPopover text={helpCopy[tab]} />
          </nav>

          <main className="flex-1 overflow-hidden">
            {tab === 'diff' ? (
              <DiffView status={status} />
            ) : tab === 'items' ? (
              <SyncItemsView
                status={status}
                showSelectionOnboardingHint={showSelectionOnboardingHint}
                onDismissSelectionOnboardingHint={() => setShowSelectionOnboardingHint(false)}
              />
            ) : tab === 'doctor' ? (
              <DoctorView />
            ) : (
              <SettingsView onSaved={fetchStatus} />
            )}
          </main>
        </div>
      )}
    </div>
  )
}

export default App
