import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { RigsyncConfigDto } from '../../../shared/ipc'

/**
 * R1: 첫 실행 이후 설정 화면 — 온보딩 위저드가 한 번만 물어보고 다시는 못 바꾸던
 * 필드(machineName·role·manifestDir·profile·autostartEnabled·
 * driftCheckIntervalHours)를 여기서 편집한다. 저장은 `engine:updateConfig`
 * (내부적으로 온보딩과 같은 `writeConfigFile` 재사용) — 저장 즉시 main의 ctx
 * 캐시가 무효화되고 스케줄러 간격까지 재해석된다(주석 참조).
 */

const inputClass =
  'w-full rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none'

function SettingsView(): React.JSX.Element {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
  }

  const roleChanged = role !== loaded.role
  const manifestDirChanged = manifestDir.trim() !== loaded.manifestDir
  const canSave = machineId.trim().length > 0 && manifestDir.trim().length > 0 && !saving

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">머신 이름</label>
        <input
          className={inputClass}
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
        />
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">역할 (role)</label>
        <select
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value as 'reference' | 'follower')}
        >
          <option value="reference">reference — 이 머신에서 capture(저작)하고 commit+push</option>
          <option value="follower">follower — pull+apply만 수신 (capture 비활성)</option>
        </select>
        {roleChanged && role === 'follower' && (
          <p className="font-mono text-xs text-amber-400">
            ⚠ reference → follower: 저장하면 이 머신에서 capture가 즉시 차단됩니다(follower는
            pull+apply만 수신). follower UI 동작을 확인하려는 용도로도 쓸 수 있습니다.
          </p>
        )}
        {roleChanged && role === 'reference' && (
          <p className="font-mono text-xs text-amber-400">
            ⚠ follower → reference: 저장하면 이 머신이 manifest에 대한 저작 권한을 갖습니다 —
            이제부터 capture 결과가 commit+push됩니다.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">manifest 저장소 경로</label>
        <input
          className={inputClass}
          value={manifestDir}
          onChange={(e) => setManifestDir(e.target.value)}
        />
        <p className="font-mono text-xs text-neutral-500">
          경로만 바뀌며 기존 데이터를 새 경로로 옮기지 않습니다 — 직접 이동/복사해야 합니다.
        </p>
        {manifestDirChanged && (
          <p className="font-mono text-xs text-amber-400">
            ⚠ 저장하면 이 머신은 새 경로를 manifest로 사용합니다. 그 경로에 아직 유효한 manifest가
            없으면 capture 전까지는 빈 상태로 보일 수 있습니다.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">profile (선택)</label>
        <input
          className={inputClass}
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="비워두면 common→host 2단 병합"
        />
      </section>

      <section className="space-y-1">
        <label className="block text-xs font-medium text-neutral-300">
          drift 체크 반복 간격 (시간, 0=끔)
        </label>
        <input
          type="number"
          min={0}
          className={inputClass}
          value={driftCheckIntervalHours}
          onChange={(e) => setDriftCheckIntervalHours(Math.max(0, Number(e.target.value) || 0))}
        />
      </section>

      <section>
        <label className="flex items-center gap-2 font-mono text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={autostartEnabled}
            onChange={(e) => setAutostartEnabled(e.target.checked)}
          />
          로그인 시 자동 시작 (트레이 상주)
        </label>
      </section>

      {error && <p className="font-mono text-xs text-red-400">error: {error}</p>}
      {saved && !error && (
        <p className="font-mono text-xs text-green-400">저장됨 — 즉시 반영됩니다.</p>
      )}

      <Button disabled={!canSave} onClick={handleSave}>
        {saving ? '저장 중…' : '저장'}
      </Button>
    </div>
  )
}

export default SettingsView
