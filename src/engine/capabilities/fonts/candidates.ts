/**
 * "동기화 항목" 화면(P2a 결정 ⑤)의 fonts 그룹 — appimage/candidates.ts와 같은
 * shape(SyncItemGroup)를 쓴다. managed = manifest에 있는 폰트 이름,
 * unmanaged = 레지스트리로 식별됐지만 manifest엔 없는 것.
 */
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import type { SyncItemGroup } from '../../syncItems'
import { FONTS_KEY_FIELDS, FONTS_LAYER } from './constants'
import { groupInstalledFontFiles } from './scan'
import type { FontEntry } from './types'

export async function buildFontsSyncGroup(ctx: RigsyncContext): Promise<SyncItemGroup | null> {
  const ignore = readIgnoreSet(ctx, 'fonts', 'names')
  const manifest =
    (effectiveLayer(ctx, FONTS_LAYER, FONTS_KEY_FIELDS).font as FontEntry[] | undefined) ?? []
  const managedSet = new Set(manifest.map((e) => e.name))
  const { resolvedByName } = groupInstalledFontFiles(ctx)
  const names = [...new Set([...managedSet, ...resolvedByName.keys()])].sort()
  if (names.length === 0) return null

  return {
    capability: 'fonts',
    title: 'fonts',
    items: names.map((name) => {
      const files = resolvedByName.get(name)
      return {
        key: name,
        label: name,
        managed: managedSet.has(name),
        ignored: ignore.has(name),
        // 이 머신에 실제로 설치돼 있어야만(resolvedByName에 잡혀야만) 알 수
        // 있다 -- manifest엔 있지만 이 머신엔 없는 항목은 description이 없다.
        description: files ? `${files.length}개 파일 설치됨` : undefined
      }
    })
  }
}
