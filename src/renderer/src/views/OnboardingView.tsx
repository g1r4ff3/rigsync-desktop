import { useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { HelpPopover } from '@/components/HelpPopover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonCopy, helpCopy } from '../copy'
import { StatusText } from '../status'
import type {
  CompleteOnboardingRequest,
  EngineStatus,
  ManifestSourceMode
} from '../../../shared/ipc'

/**
 * 온보딩 위저드(P4) — 첫 실행(firstRun) 시 메인 화면 대신 이걸 보여준다.
 * 온보딩 투어는 만들지 않는다(계약 명시 — v1 범위 밖). 폼 자체가 설명을
 * 겸한다(Explanability 4층을 그대로 적용).
 *
 * R2: 구 rigsync 마이그레이션 옵션은 제거됐다(사용자 결정 — fresh capture로
 * 충분). manifest 저장소는 "새로 만들기"/"기존 경로 지정" 2택.
 */

interface OnboardingViewProps {
  readonly status: EngineStatus
  readonly onComplete: (status: EngineStatus) => void
}

const inputClass =
  'w-full rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none'

function OnboardingView({ status, onComplete }: OnboardingViewProps): React.JSX.Element {
  const [machineId, setMachineId] = useState(status.machineId)
  const [role, setRole] = useState<'reference' | 'follower'>('reference')
  const [manifestSource, setManifestSource] = useState<ManifestSourceMode>('new')
  const [manifestDir, setManifestDir] = useState(status.manifestDir)
  const [profile, setProfile] = useState('')
  const [autostartEnabled, setAutostartEnabled] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      const request: CompleteOnboardingRequest = {
        machineId: machineId.trim(),
        role,
        manifestDir: manifestDir.trim(),
        manifestSource,
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

  const canSubmit = machineId.trim().length > 0 && manifestDir.trim().length > 0 && !submitting

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
              checked={manifestSource === 'existing'}
              onChange={() => setManifestSource('existing')}
            />
            기존 경로 지정
          </label>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <input
              className={inputClass}
              value={manifestDir}
              onChange={(e) => setManifestDir(e.target.value)}
              placeholder="~/.local/share/rigsync-desktop/manifest"
            />
          </TooltipTrigger>
          <TooltipContent>여러 머신이 공유하는 manifest 저장소 경로</TooltipContent>
        </Tooltip>
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
        disabled={!canSubmit}
        onClick={handleSubmit}
      />
    </div>
  )
}

export default OnboardingView
