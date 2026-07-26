import { useEffect, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonCopy, emptyStateCopy } from '../copy'
import { StatusText } from '../status'
import type { RigsyncConfigDto } from '../../../shared/ipc'

/**
 * R1: 첫 실행 이후 설정 화면 — 온보딩 위저드가 한 번만 물어보고 다시는 못 바꾸던
 * 필드(machineName·role·manifestDir·profile·autostartEnabled·
 * driftCheckIntervalHours)를 여기서 편집한다. 저장은 `engine:updateConfig`
 * (내부적으로 온보딩과 같은 `writeConfigFile` 재사용) — 저장 즉시 main의 ctx
 * 캐시가 무효화되고 스케줄러 간격까지 재해석된다(주석 참조).
 *
 * R2: main의 ctx는 저장 즉시 재해석되지만 renderer(App.tsx 헤더 등)는 그
 * 변화를 모른다 — `onSaved`로 App에 "지금 다시 조회하라"고 알린다.
 */

const inputClass =
  'w-full rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none'

interface SettingsViewProps {
  /** 저장 성공 직후 호출 — App이 헤더 등에 쓰는 EngineStatus를 다시 조회하게 한다(R2). */
  readonly onSaved?: () => void
}

function SettingsView({ onSaved }: SettingsViewProps): React.JSX.Element {
  const [loaded, setLoaded] = useState<RigsyncConfigDto | null>(null)
  const [machineId, setMachineId] = useState('')
  const [role, setRole] = useState<'reference' | 'follower'>('reference')
  const [manifestDir, setManifestDir] = useState('')
  const [profile, setProfile] = useState('')
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [driftCheckIntervalHours, setDriftCheckIntervalHours] = useState(6)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 복구용 클론(선택 기능) -- follower가 빈 로컬 저장소로 잘못 시작됐을 때
  // 온보딩을 다시 하지 않고 여기서 클론해 연결한다.
  const [cloneRepoUrl, setCloneRepoUrl] = useState('')
  const [cloneTargetDir, setCloneTargetDir] = useState('')
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [cloneSucceeded, setCloneSucceeded] = useState(false)

  useEffect(() => {
    window.api.engine.getConfig().then((config) => {
      setLoaded(config)
      setMachineId(config.machineId)
      setRole(config.role)
      setManifestDir(config.manifestDir)
      setProfile(config.profile ?? '')
      setAutostartEnabled(config.autostartEnabled)
      setDriftCheckIntervalHours(config.driftCheckIntervalHours)
    }, console.error)
  }, [])

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await window.api.engine.updateConfig({
        machineId: machineId.trim(),
        role,
        manifestDir: manifestDir.trim(),
        ...(profile.trim() ? { profile: profile.trim() } : {}),
        autostartEnabled,
        driftCheckIntervalHours
      })
      setLoaded(updated)
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleClone(): Promise<void> {
    setCloning(true)
    setCloneError(null)
    setCloneSucceeded(false)
    try {
      const response = await window.api.engine.cloneManifestRepo({
        repoUrl: cloneRepoUrl.trim(),
        manifestDir: cloneTargetDir.trim()
      })
      if (!response.ok) {
        setCloneError(response.error ?? '클론 실패')
        return
      }
      if (response.config) {
        setLoaded(response.config)
        setManifestDir(response.config.manifestDir)
      }
      setCloneSucceeded(true)
      onSaved?.()
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err))
    } finally {
      setCloning(false)
    }
  }

  if (!loaded) {
    return <p className="text-xs text-muted-foreground">{emptyStateCopy.loading}</p>
  }

  const roleChanged = role !== loaded.role
  const manifestDirChanged = manifestDir.trim() !== loaded.manifestDir
  const canSave = machineId.trim().length > 0 && manifestDir.trim().length > 0 && !saving

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* R4-2 #2/#3: 화면별 "?" 헬프는 App.tsx 탭 바 우측 끝으로 통일했으니
          여기 있던 단독 ViewToolbar(딴 컨트롤 없이 "?" 하나만 떠 있던 자리)는
          제거한다. 폼도 Differences처럼 좌측 정렬로 맞추고(mx-auto 제거) 폭만
          640px로 제한 — 이전엔 mx-auto가 폼을 가운데/우측으로 밀어 좌측에
          쓸모없는 빈 열이 생겼다(사용자 지적 사례). */}
      <div className="max-w-[640px] space-y-6">
        <section className="space-y-1">
          <label className="block text-xs font-medium text-foreground">Machine name</label>
          <Tooltip>
            <TooltipTrigger asChild>
              <input
                className={inputClass}
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
              />
            </TooltipTrigger>
            <TooltipContent>이 머신을 구별하는 고유 이름 — hostname 중복에 주의</TooltipContent>
          </Tooltip>
        </section>

        <section className="space-y-1">
          <label className="block text-xs font-medium text-foreground">Role</label>
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
            <TooltipContent>reference=저작 / follower=수신 전용 (단방향 배포)</TooltipContent>
          </Tooltip>
          {roleChanged && role === 'follower' && (
            <StatusText kind="warn">
              reference → follower: 저장하면 이 머신에서 capture가 즉시 차단됩니다(follower는
              pull+apply만 수신). follower UI 동작을 확인하려는 용도로도 쓸 수 있습니다.
            </StatusText>
          )}
          {roleChanged && role === 'reference' && (
            <StatusText kind="warn">
              follower → reference: 저장하면 이 머신이 manifest에 대한 저작 권한을 갖습니다 —
              이제부터 capture 결과가 commit+push됩니다.
            </StatusText>
          )}
        </section>

        <section className="space-y-1">
          <label className="block text-xs font-medium text-foreground">Manifest path</label>
          <Tooltip>
            <TooltipTrigger asChild>
              <input
                className={inputClass}
                value={manifestDir}
                onChange={(e) => setManifestDir(e.target.value)}
              />
            </TooltipTrigger>
            <TooltipContent>여러 머신이 공유하는 manifest 저장소 경로</TooltipContent>
          </Tooltip>
          <p className="text-xs text-muted-foreground">
            경로만 바뀌며 기존 데이터를 새 경로로 옮기지 않습니다 — 직접 이동/복사해야 합니다.
          </p>
          {manifestDirChanged && (
            <StatusText kind="warn">
              저장하면 이 머신은 새 경로를 manifest로 사용합니다. 그 경로에 아직 유효한 manifest가
              없으면 capture 전까지는 빈 상태로 보일 수 있습니다.
            </StatusText>
          )}
        </section>

        <section className="space-y-1 rounded-md border border-border p-3">
          <label className="block text-xs font-medium text-foreground">
            Clone from repository (recovery)
          </label>
          <p className="text-xs text-muted-foreground">
            follower가 빈 로컬 저장소로 잘못 시작됐을 때, 온보딩을 다시 하지 않고 여기서 기준
            저장소를 클론해 연결합니다.
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <input
                className={inputClass}
                value={cloneRepoUrl}
                onChange={(e) => setCloneRepoUrl(e.target.value)}
                placeholder="https://github.com/you/rigsync-manifest.git"
              />
            </TooltipTrigger>
            <TooltipContent>
              클론할 manifest 저장소 URL — private 저장소는 gh auth 설정이 먼저 필요합니다
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <input
                className={inputClass}
                value={cloneTargetDir}
                onChange={(e) => setCloneTargetDir(e.target.value)}
                placeholder="~/.local/share/rigsync-desktop/manifest"
              />
            </TooltipTrigger>
            <TooltipContent>클론될 위치 (비어 있거나 아직 없어야 합니다)</TooltipContent>
          </Tooltip>
          {cloneError && <StatusText kind="error">{cloneError}</StatusText>}
          {cloneSucceeded && !cloneError && (
            <StatusText kind="ok">클론 완료 — 이 머신의 manifest 경로가 갱신됐습니다.</StatusText>
          )}
          <ActionButton
            variant="secondary"
            label={buttonCopy.cloneManifestRepo.label}
            subtitle={buttonCopy.cloneManifestRepo.subtitle}
            disabledReason={buttonCopy.cloneManifestRepoDisabled}
            busy={cloning}
            disabled={
              cloning || cloneRepoUrl.trim().length === 0 || cloneTargetDir.trim().length === 0
            }
            onClick={() => void handleClone()}
          />
        </section>

        <section className="space-y-1">
          <label className="block text-xs font-medium text-foreground">Profile (optional)</label>
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

        <section className="space-y-1">
          <label className="block text-xs font-medium text-foreground">
            Drift check interval (hours, 0 = off)
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={driftCheckIntervalHours}
                onChange={(e) =>
                  setDriftCheckIntervalHours(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </TooltipTrigger>
            <TooltipContent>0으로 두면 트레이 상주 drift 감시가 완전히 꺼집니다</TooltipContent>
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
                Start on login (tray)
              </label>
            </TooltipTrigger>
            <TooltipContent>로그인 시 트레이 상주 상태로 자동 시작합니다</TooltipContent>
          </Tooltip>
        </section>

        {error && <StatusText kind="error">{error}</StatusText>}
        {saved && !error && <StatusText kind="ok">저장됨 — 즉시 반영됩니다.</StatusText>}

        <ActionButton
          label={buttonCopy.saveSettings.label}
          subtitle={buttonCopy.saveSettings.subtitle}
          disabledReason={buttonCopy.saveSettingsDisabled}
          busy={saving}
          disabled={!canSave}
          onClick={handleSave}
        />
      </div>
    </div>
  )
}

export default SettingsView
