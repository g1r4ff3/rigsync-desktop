import { useEffect, useRef, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { HelpPopover } from '@/components/HelpPopover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonCopy, helpCopy } from '../copy'
import { StatusText } from '../status'
import type {
  CompleteOnboardingRequest,
  EngineStatus,
  ManifestPathCheckDto,
  ManifestSourceMode
} from '../../../shared/ipc'

/**
 * 온보딩 위저드(P4) — 첫 실행(firstRun) 시 메인 화면 대신 이걸 보여준다.
 * 온보딩 투어는 만들지 않는다(계약 명시 — v1 범위 밖). 폼 자체가 설명을
 * 겸한다(Explanability 4층을 그대로 적용).
 *
 * R2: 구 rigsync 마이그레이션 옵션은 제거됐다(사용자 결정 — fresh capture로
 * 충분). manifest 저장소는 "새로 만들기"/"기존 경로 지정"/"저장소에서 클론" 3택
 * (clone은 실사용 결함 수정 — follower의 정상 진입 경로가 온보딩에 없었다:
 * follower를 온보딩하면 manifest가 원격과 연결 안 된 빈 로컬 디렉터리로
 * 만들어져 앱이 아무 경고 없이 "정상"처럼 보여줬다).
 */

interface OnboardingViewProps {
  readonly status: EngineStatus
  readonly onComplete: (status: EngineStatus) => void
  /** R4 스크린샷 하네스 전용 — 'onboarding-clone' route가 클론 탭을 미리 선택해 보여주게 한다. */
  readonly initialManifestSource?: ManifestSourceMode
}

const inputClass =
  'w-full rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none'

function OnboardingView({
  status,
  onComplete,
  initialManifestSource
}: OnboardingViewProps): React.JSX.Element {
  const [machineId, setMachineId] = useState(status.machineId)
  const [role, setRole] = useState<'reference' | 'follower'>('reference')
  const [manifestSource, setManifestSource] = useState<ManifestSourceMode>(
    initialManifestSource ?? 'new'
  )
  const [manifestDir, setManifestDir] = useState(status.manifestDir)
  const [repoUrl, setRepoUrl] = useState('')
  const [profile, setProfile] = useState('')
  const [autostartEnabled, setAutostartEnabled] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 실사용 결함 수정: "기존 경로 지정"은 무검증 mkdir -p였다 -- follower가
  // 빈 로컬 디렉터리를 가리켜도 조용히 정상처럼 보였다. 경로를 입력할 때마다
  // (디바운스) 조회만 하고, 결과는 경고로만 보여준다 -- 진행 자체는 막지
  // 않는다(새 manifest를 의도적으로 시작하는 경우도 있다).
  //
  // useEffect로 manifestDir 변화를 "구독"하는 대신, 값이 바뀌는 이벤트
  // 핸들러(아래 triggerPathCheck) 안에서 직접 디바운스+조회한다 -- 리액트
  // 팀 권고(effect는 외부 시스템 동기화용, 파생 조회는 이벤트 핸들러가 직접)
  // 그대로다. 언마운트 시 남은 타이머만 정리하면 되므로 ref 하나로 충분하다.
  const [pathCheck, setPathCheck] = useState<ManifestPathCheckDto | null>(null)
  const [pathChecking, setPathChecking] = useState(false)
  const pathCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function triggerPathCheck(dir: string): void {
    if (pathCheckTimerRef.current) clearTimeout(pathCheckTimerRef.current)
    if (dir.trim().length === 0) {
      setPathCheck(null)
      setPathChecking(false)
      return
    }
    setPathChecking(true)
    pathCheckTimerRef.current = setTimeout(() => {
      window.api.engine
        .validateManifestPath({ manifestDir: dir.trim() })
        .then(setPathCheck, console.error)
        .finally(() => setPathChecking(false))
    }, 400)
  }

  function handleManifestDirChange(next: string): void {
    setManifestDir(next)
    if (manifestSource === 'existing') triggerPathCheck(next)
  }

  function handleSelectExisting(): void {
    setManifestSource('existing')
    triggerPathCheck(manifestDir)
  }

  // 언마운트 시 남은 디바운스 타이머만 정리한다 -- setState는 안 부른다.
  useEffect(() => {
    return () => {
      if (pathCheckTimerRef.current) clearTimeout(pathCheckTimerRef.current)
    }
  }, [])

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      const request: CompleteOnboardingRequest = {
        machineId: machineId.trim(),
        role,
        manifestDir: manifestDir.trim(),
        manifestSource,
        ...(manifestSource === 'clone' ? { repoUrl: repoUrl.trim() } : {}),
        ...(profile.trim() ? { profile: profile.trim() } : {}),
        autostartEnabled
      }
      const response = await window.api.engine.completeOnboarding(request)
      onComplete(response.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    machineId.trim().length > 0 &&
    manifestDir.trim().length > 0 &&
    (manifestSource !== 'clone' || repoUrl.trim().length > 0) &&
    !submitting

  return (
    <div className="mx-auto max-w-xl space-y-6 py-8">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Welcome to rigsync</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            이 머신을 어떻게 부를지, 어떤 역할을 할지, manifest를 어디서 가져올지 정합니다.
          </p>
        </div>
        <HelpPopover text={helpCopy.onboarding} />
      </header>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-foreground">① Machine name</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              className={inputClass}
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
            />
          </TooltipTrigger>
          <TooltipContent>
            이 머신을 구별하는 고유 이름 — 나중에 Settings에서 바꿀 수 있습니다
          </TooltipContent>
        </Tooltip>
        <StatusText kind="warn">
          기본값은 이 머신의 hostname입니다. 이미 hostname이 같은 머신이 여러 대 있다면(예: 여러
          데스크톱이 전부 &ldquo;cglab&rdquo;처럼 설정된 경우) 반드시 서로 다른 이름을 직접
          지어주세요 — hostname은 머신 식별자로 안전하지 않습니다.
        </StatusText>
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-foreground">② Role</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value as 'reference' | 'follower')}
            >
              <option value="reference">
                reference — 이 머신에서 capture(저작)하고 commit+push
              </option>
              <option value="follower">follower — pull+apply만 수신 (capture 비활성)</option>
            </select>
          </TooltipTrigger>
          <TooltipContent>
            reference=저작 / follower=수신 전용 (단방향 배포) — 나중에 바꿀 수 있습니다
          </TooltipContent>
        </Tooltip>
      </section>

      <section className="space-y-2">
        <label className="block text-xs font-medium text-foreground">③ Manifest storage</label>
        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={manifestSource === 'new'}
              onChange={() => setManifestSource('new')}
            />
            새로 만들기(빈 로컬 디렉터리 초기화)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={manifestSource === 'clone'}
              onChange={() => setManifestSource('clone')}
            />
            저장소에서 클론(follower의 정상 시작 방법)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={manifestSource === 'existing'}
              onChange={handleSelectExisting}
            />
            기존 경로 지정
          </label>
        </div>

        {manifestSource === 'clone' && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <input
                  className={inputClass}
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/rigsync-manifest.git"
                />
              </TooltipTrigger>
              <TooltipContent>
                클론할 manifest 저장소 URL — private 저장소는 gh auth 설정이 먼저 필요합니다
              </TooltipContent>
            </Tooltip>
            <StatusText kind="warn">
              follower는 이 방법으로 시작해야 합니다 — 기준(reference) 머신이 이미 commit+push해 둔
              manifest를 그대로 받아옵니다. &ldquo;새로 만들기&rdquo;로 시작하면 원격과 연결되지
              않은 빈 로컬 저장소가 되어 다른 머신과 동기화되지 않습니다.
            </StatusText>
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <input
              className={inputClass}
              value={manifestDir}
              onChange={(e) => handleManifestDirChange(e.target.value)}
              placeholder="~/.local/share/rigsync-desktop/manifest"
            />
          </TooltipTrigger>
          <TooltipContent>
            {manifestSource === 'clone'
              ? '클론될 위치 (비어 있거나 아직 없어야 합니다)'
              : '여러 머신이 공유하는 manifest 저장소 경로'}
          </TooltipContent>
        </Tooltip>

        {manifestSource === 'existing' && pathChecking && (
          <p className="text-xs text-muted-foreground">경로 확인 중…</p>
        )}
        {manifestSource === 'existing' &&
          !pathChecking &&
          pathCheck &&
          pathCheck.warnings.map((w) => (
            <StatusText key={w} kind="warn">
              {w}
            </StatusText>
          ))}
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-foreground">④ Profile (optional)</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              className={inputClass}
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="비워두면 common→host 2단 병합"
            />
          </TooltipTrigger>
          <TooltipContent>있으면 common→profile→host 3단 병합으로 전환</TooltipContent>
        </Tooltip>
      </section>

      <section>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={autostartEnabled}
                onChange={(e) => setAutostartEnabled(e.target.checked)}
              />
              ⑤ Start on login (tray)
            </label>
          </TooltipTrigger>
          <TooltipContent>로그인 시 트레이 상주 상태로 자동 시작합니다</TooltipContent>
        </Tooltip>
      </section>

      {error && <StatusText kind="error">{error}</StatusText>}

      <ActionButton
        label={buttonCopy.completeOnboarding.label}
        subtitle={buttonCopy.completeOnboarding.subtitle}
        disabledReason={
          manifestSource === 'clone' ? buttonCopy.completeOnboardingDisabledClone : undefined
        }
        busy={submitting}
        disabled={!canSubmit}
        onClick={handleSubmit}
      />
    </div>
  )
}

export default OnboardingView
