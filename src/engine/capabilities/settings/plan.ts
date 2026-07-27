/**
 * settings(dconf) plan — 구 repo `plan_dconf`(rigsync.py:1521) 행동 이식.
 * `dconf load`는 sudo가 필요 없는 사용자 명령이라 `privileged: false`다 — apt와
 * 달리 이 액션은 PlanExecutor가 테스트에서도 실제로 `run()`을 호출하므로, 라이브
 * dconf 조회/적용은 전부 `DconfProvider` 뒤로 격리한다(P2c flatpak override 복원과
 * 같은 이유 — 라이브 경로가 homeDir 밖 시스템 상태라 provider 없이 직접 만지면
 * 테스트가 개발자의 진짜 dconf DB를 건드리게 된다).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { SETTINGS_KEY_FIELDS, SETTINGS_LAYER } from './constants'
import type { DconfProvider } from './providerTypes'
import type { SettingsDiffReport, SettingsManifest } from './types'

export function planSettings(
  ctx: RigsyncContext,
  provider: DconfProvider,
  diff: SettingsDiffReport
): PlanAction[] {
  if (diff.skipped) return []
  const manifest = effectiveLayer(ctx, SETTINGS_LAYER, SETTINGS_KEY_FIELDS) as SettingsManifest
  const byPath = new Map((manifest.path ?? []).map((e) => [e.path, e]))
  const actions: PlanAction[] = []

  for (const p of diff.contentChanged) {
    const entry = byPath.get(p)
    if (!entry) continue
    const storedPath = path.join(ctx.manifestDir, entry.file)
    actions.push({
      capability: 'settings',
      summary: `dconf load ${p}`,
      commands: [`dconf load ${p} < ${storedPath}`],
      privileged: false,
      run: async () => {
        const data = fs.readFileSync(storedPath, 'utf-8')
        const result = await provider.load(p, data)
        return { ok: result.ok, detail: result.output || (result.ok ? `loaded ${p}` : '로드 실패') }
      }
    })
  }

  return actions
}
