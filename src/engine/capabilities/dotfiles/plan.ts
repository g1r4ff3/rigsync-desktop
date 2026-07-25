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
import { effectiveLayer } from '../../manifest'
import { expandHome } from '../../paths'
import type { PlanAction } from '../../plan'
import { doBackup } from '../../safety/backup'
import { matchesDenylist } from '../../safety/denylist'
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
