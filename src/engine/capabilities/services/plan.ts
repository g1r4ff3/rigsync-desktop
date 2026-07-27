/**
 * services plan — 구 repo `plan_services`(rigsync.py:1582) 행동 이식: 유닛당
 * 하나의 액션으로 "백업 → 유닛 파일 교체 → daemon-reload → (필요하면) enable"을
 * 묶는다. `systemctl --user`는 unprivileged라 `run()`이 테스트에서도 실제
 * 호출되므로 라이브 파일 IO는 전부 `SystemdUserProvider`를 거친다(providerTypes.ts
 * 주석 참조). 백업만 `ctx.backupRoot`에 직접 쓴다(homeDir 밖 시스템 상태라
 * dotfiles의 `doBackup`을 그대로 못 쓰지만 "덮어쓰기 전 백업" 안전선은 동일).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { SERVICES_KEY_FIELDS, SERVICES_LAYER } from './constants'
import type { SystemdUserProvider } from './providerTypes'
import type { ServicesDiffReport, ServicesManifest } from './types'

export function planServices(
  ctx: RigsyncContext,
  provider: SystemdUserProvider,
  diff: ServicesDiffReport,
  runTs: string
): PlanAction[] {
  const manifest = effectiveLayer(ctx, SERVICES_LAYER, SERVICES_KEY_FIELDS) as ServicesManifest
  const byName = new Map((manifest.unit ?? []).map((u) => [u.name, u]))
  const namesToRestore = new Set([...diff.missing, ...diff.contentChanged, ...diff.enabledMismatch])
  const actions: PlanAction[] = []

  for (const name of [...namesToRestore].sort()) {
    const u = byName.get(name)
    if (!u) continue
    const storedPath = path.join(ctx.manifestDir, u.file)

    actions.push({
      capability: 'services',
      summary: `restore unit ${name}`,
      commands: [
        `cp ${storedPath} ~/.config/systemd/user/${name}`,
        'systemctl --user daemon-reload',
        ...(u.enabled ? [`systemctl --user enable ${name}`] : [])
      ],
      privileged: false,
      run: async () => {
        if (!fs.existsSync(storedPath)) {
          return {
            ok: false,
            detail: `스토어에 유닛 파일이 없음 (${u.file}) -- capture를 먼저 실행하세요`
          }
        }
        const live = provider.readUnitFile(name)
        if (live !== null) {
          const backupPath = path.join(ctx.backupRoot, runTs, 'services', name)
          fs.mkdirSync(path.dirname(backupPath), { recursive: true })
          fs.writeFileSync(backupPath, live)
        }
        const storedContent = fs.readFileSync(storedPath, 'utf-8')
        const write = provider.writeUnitFile(name, storedContent)
        if (!write.ok) return { ok: false, detail: write.output || '유닛 파일 쓰기 실패' }

        // 순차 의존 -- daemon-reload가 먼저 끝나야 enable이 의미 있다.
        const reload = await provider.daemonReload()
        let ok = reload.ok
        let detail = reload.output

        if (u.enabled) {
          const enable = await provider.enable(name)
          ok = ok && enable.ok
          detail += enable.output
        }
        return { ok, detail: detail || 'ok' }
      }
    })
  }

  return actions
}
