import { useEffect, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { HelpPopover } from '@/components/HelpPopover'
import { ViewToolbar } from '@/components/ViewToolbar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonCopy, emptyStateCopy, helpCopy } from '../copy'
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

  if (!loaded) {
    return <p className="text-xs text-muted-foreground">{emptyStateCopy.loading}</p>
  }

  const roleChanged = role !== loaded.role
  const manifestDirChanged = manifestDir.trim() !== loaded.manifestDir
  const canSave = machineId.trim().length > 0 && manifestDir.trim().length > 0 && !saving

  return (
    <div className="h-full overflow-y-auto pr-1">
      <ViewToolbar>
        <HelpPopover text={helpCopy.settings} />
      </ViewToolbar>

      <div className="mx-auto max-w-xl space-y-6">
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
