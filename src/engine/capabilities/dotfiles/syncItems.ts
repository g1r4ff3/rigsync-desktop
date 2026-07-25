/**
 * "동기화 항목" 화면(P2a 결정 ⑤)의 dotfiles 그룹 — managed(manifest 엔트리) +
 * unmanaged(SEED_DOTFILES 중 홈엔 있지만 아직 manifest엔 없는 것 — 다음 capture가
 * 담을 후보) 대칭 나열. packages/candidates.ts와 같은 shape(SyncItem/Group)를
 * 쓴다.
 */
import fs from 'node:fs'
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { expandHome } from '../../paths'
import type { SyncItemGroup } from '../../syncItems'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { SEED_DOTFILES } from './seed'
import type { DotfileEntry } from './types'

export function buildDotfilesSyncGroup(ctx: RigsyncContext): SyncItemGroup | null {
  const manifest = effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
  const entries = (manifest.entry as DotfileEntry[] | undefined) ?? []
  const managedHomes = new Set(entries.map((e) => e.home))
  const ignore = readIgnoreSet(ctx, 'dotfiles', 'homes')

  const candidateHomes = SEED_DOTFILES.map((s) => s.home).filter(
    (home) => !managedHomes.has(home) && fs.existsSync(expandHome(ctx, home))
  )

  const homes = [...new Set([...managedHomes, ...candidateHomes])].sort()
  if (homes.length === 0) return null

  return {
    capability: 'dotfiles',
    title: 'dotfiles',
    items: homes.map((home) => ({
      key: home,
      label: home,
      managed: managedHomes.has(home),
      ignored: ignore.has(home)
    }))
  }
}
