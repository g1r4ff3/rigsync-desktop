import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type {
  CompleteOnboardingRequest,
  EngineStatus,
  LegacyMigrationSummaryDto,
  ManifestSourceMode
} from '../../../shared/ipc'

/**
 * 온보딩 위저드(P4) — 첫 실행(firstRun) 시 메인 화면 대신 이걸 보여준다.
 * 기능 최소 UI 지시(디자인 패스는 이후 별도 트랙) — 순수 HTML 폼 요소만 쓴다.
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
  const [legacyRepoPath, setLegacyRepoPath] = useState('~/repos/rigsync')
  const [profile, setProfile] = useState('')
  const [autostartEnabled, setAutostartEnabled] = useState(true)

  const [preview, setPreview] = useState<LegacyMigrationSummaryDto | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePreview(): Promise<void> {
    setPreviewing(true)
    setError(null)
    try {
      const summary = await window.api.engine.previewLegacyMigration({ legacyRepoPath })
      setPreview(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      const request: CompleteOnboardingRequest = {
        machineId: machineId.trim(),
        role,
        manifestDir: manifestDir.trim(),
        manifestSource,
        ...(manifestSource === 'migrate' ? { legacyRepoPath: legacyRepoPath.trim() } : {}),
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
      <header>
        <h1 className="text-lg font-semibold tracking-tight">rigsync 첫 설정</h1>
        <p className="mt-1 font-mono text-xs text-neutral-500">
          이 머신을 어떻게 부를지, 어떤 역할을 할지, manifest를 어디서 가져올지 정합니다.
        </p>
      </header>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">① 머신 이름</label>
        <input
          className={inputClass}
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
        />
        <p className="font-mono text-xs text-amber-400">
          ⚠ 기본값은 이 머신의 hostname입니다. 이미 hostname이 같은 머신이 여러 대 있다면(예: 여러
          데스크톱이 전부 &ldquo;cglab&rdquo;처럼 설정된 경우) 반드시 서로 다른 이름을 직접
          지어주세요 — hostname은 머신 식별자로 안전하지 않습니다.
        </p>
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">② 역할 (role)</label>
        <select
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value as 'reference' | 'follower')}
        >
          <option value="reference">reference — 이 머신에서 capture(저작)하고 commit+push</option>
          <option value="follower">follower — pull+apply만 수신 (capture 비활성)</option>
        </select>
      </section>

      <section className="space-y-2">
        <label className="block text-xs font-medium text-neutral-300">③ manifest 저장소</label>
        <div className="space-y-2 font-mono text-xs">
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
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={manifestSource === 'migrate'}
              onChange={() => setManifestSource('migrate')}
            />
            구 rigsync에서 마이그레이션
          </label>
        </div>

        {manifestSource !== 'migrate' ? (
          <input
            className={inputClass}
            value={manifestDir}
            onChange={(e) => setManifestDir(e.target.value)}
            placeholder="~/.local/share/rigsync-desktop/manifest"
          />
        ) : (
          <div className="space-y-2">
            <input
              className={inputClass}
              value={legacyRepoPath}
              onChange={(e) => setLegacyRepoPath(e.target.value)}
              placeholder="~/repos/rigsync"
            />
            <input
              className={inputClass}
              value={manifestDir}
              onChange={(e) => setManifestDir(e.target.value)}
              placeholder="새 manifest가 만들어질 경로"
            />
            <Button
              variant="secondary"
              type="button"
              disabled={previewing || !legacyRepoPath.trim()}
              onClick={handlePreview}
            >
              {previewing ? '변환 요약 계산 중…' : '변환 요약 미리보기'}
            </Button>
            {preview && (
              <ul className="space-y-1 rounded border border-border p-2 font-mono text-xs">
                {preview.warnings.map((w) => (
                  <li key={w} className="text-red-400">
                    ⚠ {w}
                  </li>
                ))}
                {preview.items.map((item) => (
                  <li
                    key={item.capability}
                    className={
                      item.action === 'migrated'
                        ? 'text-green-400'
                        : item.action === 'reported-only'
                          ? 'text-amber-400'
                          : 'text-neutral-500'
                    }
                  >
                    [{item.action}] {item.capability}: {item.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">④ profile (선택)</label>
        <input
          className={inputClass}
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="비워두면 common→host 2단 병합"
        />
      </section>

      <section>
        <label className="flex items-center gap-2 font-mono text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={autostartEnabled}
            onChange={(e) => setAutostartEnabled(e.target.checked)}
          />
          ⑤ 로그인 시 자동 시작 (트레이 상주)
        </label>
      </section>

      {error && <p className="font-mono text-xs text-red-400">error: {error}</p>}

      <Button disabled={!canSubmit} onClick={handleSubmit}>
        {submitting ? '설정 중…' : '완료'}
      </Button>
    </div>
  )
}

export default OnboardingView
