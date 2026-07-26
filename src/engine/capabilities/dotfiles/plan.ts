/**
 * diff 결과를 실행 가능한 PlanAction[]으로 바꾼다. 구 repo `plan_dotfiles`/
 * `make_link_action`/`make_copy_action`/`make_invalid_store_action` 행동을
 * 옮긴 것(코드 복사 아님):
 *
 * - link 액션 = 스토어 → 홈 symlink (백업 먼저, 기존 대상 제거 후 symlink).
 * - copy 액션 = 스토어 → 홈 파일 복사 + chmod (link:false 엔트리, 예: ~/.ssh/config).
 * - invalid_store 항목은 "always_run" 거부 액션 — dry-run에서도 조용히 생략되지
 *   않고 그대로 보고된다 (부작용이 없는 순수 리포트라 confirm 게이트를 안 탄다).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink } from '../../fsUtil'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { expandHome } from '../../paths'
import type { PlanAction } from '../../plan'
import { doBackup } from '../../safety/backup'
import { matchesDenylist } from '../../safety/denylist'
import type { CapabilityUninstallResult, UninstallExclusion } from '../../uninstall/types'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { copyTreeMirror, resolveDotfileStorePath } from './fsTree'
import type { DiffReport, DotfileEntry } from './types'

function entriesByHome(ctx: RigsyncContext): Map<string, DotfileEntry> {
  const manifest = effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
  const entries = (manifest.entry as DotfileEntry[] | undefined) ?? []
  return new Map(entries.map((e) => [e.home, e]))
}

function removeHomeTarget(homePath: string): void {
  if (isSymlink(homePath)) {
    fs.unlinkSync(homePath)
  } else if (fs.existsSync(homePath)) {
    if (fs.statSync(homePath).isDirectory()) {
      fs.rmSync(homePath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(homePath)
    }
  }
}

function makeInvalidStoreAction(home: string, storeValue: unknown): PlanAction {
  return {
    capability: 'dotfiles',
    summary: `${home} — store escapes repo root`,
    commands: [],
    alwaysRun: true,
    run: async () => ({
      ok: false,
      detail: `store ${JSON.stringify(storeValue)} escapes repo root`
    })
  }
}

function makeLinkAction(ctx: RigsyncContext, entry: DotfileEntry, runTs: string): PlanAction {
  const homePath = expandHome(ctx, entry.home)
  const storePath = resolveDotfileStorePath(ctx, entry.store)
  const commands = storePath
    ? [`backup ${entry.home}`, `ln -sf ${storePath} ${homePath}`]
    : [`refuse ${entry.home}: store escapes repo root`]

  return {
    capability: 'dotfiles',
    summary: `link ${entry.home}`,
    commands,
    run: async () => {
      const basename = path.basename(homePath)
      if (matchesDenylist(basename)) {
        return { ok: false, detail: `denylist match: ${basename} (refused)` }
      }
      if (storePath === null) {
        return {
          ok: false,
          detail: `refused: store ${JSON.stringify(entry.store)} escapes repo root`
        }
      }
      if (!fs.existsSync(storePath)) {
        return {
          ok: false,
          detail:
            `refused: store path ${storePath} does not exist yet ` +
            '(nothing captured for this entry -- run capture first)'
        }
      }
      doBackup(ctx, homePath, runTs)
      if (fs.existsSync(homePath) || isSymlink(homePath)) {
        removeHomeTarget(homePath)
      }
      fs.mkdirSync(path.dirname(homePath), { recursive: true })
      fs.symlinkSync(path.resolve(storePath), homePath)
      return { ok: true, detail: `symlinked ${entry.home} -> ${storePath}` }
    }
  }
}

function makeCopyAction(ctx: RigsyncContext, entry: DotfileEntry, runTs: string): PlanAction {
  const homePath = expandHome(ctx, entry.home)
  const storePath = resolveDotfileStorePath(ctx, entry.store)
  const commands = storePath
    ? [
        `backup ${entry.home}`,
        `cp -r ${storePath} ${homePath}`,
        ...(entry.mode ? [`chmod ${entry.mode} ${homePath}`] : [])
      ]
    : [`refuse ${entry.home}: store escapes repo root`]

  return {
    capability: 'dotfiles',
    summary: `copy ${entry.home}`,
    commands,
    run: async () => {
      const basename = path.basename(homePath)
      if (matchesDenylist(basename)) {
        return { ok: false, detail: `denylist match: ${basename} (refused)` }
      }
      if (storePath === null) {
        return {
          ok: false,
          detail: `refused: store ${JSON.stringify(entry.store)} escapes repo root`
        }
      }
      if (!fs.existsSync(storePath)) {
        return {
          ok: false,
          detail:
            `refused: store path ${storePath} does not exist yet ` +
            '(nothing captured for this entry -- run capture first)'
        }
      }
      doBackup(ctx, homePath, runTs)
      copyTreeMirror(storePath, homePath)
      if (entry.mode) {
        fs.chmodSync(homePath, Number.parseInt(entry.mode, 8))
      }
      return { ok: true, detail: `copied ${storePath} -> ${entry.home}` }
    }
  }
}

export function planDotfiles(ctx: RigsyncContext, diff: DiffReport, runTs: string): PlanAction[] {
  const byHome = entriesByHome(ctx)
  const actions: PlanAction[] = []
  const plannedHomes = new Set<string>()

  for (const home of diff.invalidStore) {
    actions.push(makeInvalidStoreAction(home, byHome.get(home)?.store))
  }

  for (const home of diff.toLink) {
    const entry = byHome.get(home)
    if (!entry) continue
    actions.push(makeLinkAction(ctx, entry, runTs))
    plannedHomes.add(home)
  }

  for (const home of diff.missingHome) {
    if (plannedHomes.has(home)) continue
    const entry = byHome.get(home)
    if (!entry) continue
    actions.push(
      entry.link !== false ? makeLinkAction(ctx, entry, runTs) : makeCopyAction(ctx, entry, runTs)
    )
    plannedHomes.add(home)
  }

  for (const item of diff.contentChanged) {
    const home = item.split(' (mode')[0]
    if (plannedHomes.has(home)) continue
    const entry = byHome.get(home)
    if (!entry) continue
    actions.push(makeCopyAction(ctx, entry, runTs))
    plannedHomes.add(home)
  }

  return actions
}

/**
 * home 경로 하나를 지우는 액션 — 불변식 ②에 따라 백업 후 삭제한다. store
 * 파일은 건드리지 않는다(manifest는 별개 — 삭제는 시스템만 바꾼다, 안전
 * 불변식 5). `home`이 manifest entry를 갖고 있는지 여부와 무관하게 동작한다
 * (uninstall 대상은 항상 managed=false라 entry가 없는 게 정상 — home 경로
 * 자체만으로 충분하다).
 */
function makeDotfilesUninstallAction(
  ctx: RigsyncContext,
  home: string,
  homePath: string,
  runTs: string
): PlanAction {
  return {
    capability: 'dotfiles',
    summary: `uninstall ${home}`,
    commands: [`backup ${home}`, `rm -rf ${homePath}`],
    privileged: false,
    run: async () => {
      if (!fs.existsSync(homePath) && !isSymlink(homePath)) {
        return { ok: false, detail: `${home}: 이 머신에 없음(이미 삭제됨)` }
      }
      doBackup(ctx, homePath, runTs)
      removeHomeTarget(homePath)
      return { ok: true, detail: `삭제 완료: ${home}` }
    }
  }
}

/**
 * dotfiles uninstall 계획 — 안전 불변식 5: manifest에 선언된(managed) 항목은
 * 거부하고, ignore(일시중지)되지 않은 항목도 거부한다. 유효 대상은 항상
 * "일시중지 + 이 머신에 설치됨"뿐이다. `homes`는 `~/...` 축약형 키
 * (buildDotfilesSyncGroup의 SyncItem.key와 동일 표기).
 */
export function planDotfilesUninstall(
  ctx: RigsyncContext,
  homes: readonly string[],
  runTs: string
): CapabilityUninstallResult {
  const manifest = effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
  const entries = (manifest.entry as DotfileEntry[] | undefined) ?? []
  const managedHomes = new Set(entries.map((e) => e.home))
  const ignore = readIgnoreSet(ctx, 'dotfiles', 'homes')

  const actions: PlanAction[] = []
  const excluded: UninstallExclusion[] = []

  for (const home of homes) {
    if (managedHomes.has(home)) {
      excluded.push({
        capability: 'dotfiles',
        key: home,
        reason: 'manifest에 선언된(managed) 항목은 삭제 대상이 아님 — 먼저 일시중지(ignore)하세요'
      })
      continue
    }
    if (!ignore.has(home)) {
      excluded.push({
        capability: 'dotfiles',
        key: home,
        reason: '일시중지(ignore)되지 않은 항목은 삭제 대상이 아님'
      })
      continue
    }
    const homePath = expandHome(ctx, home)
    if (!fs.existsSync(homePath) && !isSymlink(homePath)) {
      excluded.push({ capability: 'dotfiles', key: home, reason: '이 머신에 설치돼 있지 않음' })
      continue
    }
    actions.push(makeDotfilesUninstallAction(ctx, home, homePath, runTs))
  }

  return { actions, excluded }
}
