/**
 * "동기화 항목" 화면(P2a 결정 ⑤)의 dotfiles 그룹 — managed(manifest 엔트리) +
 * unmanaged(SEED_DOTFILES 중 홈엔 있지만 아직 manifest엔 없는 것 — 다음 capture가
 * 담을 후보) 대칭 나열. packages/candidates.ts와 같은 shape(SyncItem/Group)를
 * 쓴다.
 *
 * WS6("창고 모델 1차") "SEED 강등": SEED_DOTFILES 유래 후보(managed 아직 아님)는
 * 본체 그룹에 섞지 않고 별도 `dotfiles-suggested` 서브그룹(collapsedByDefault:
 * true, "추천")으로 분리한다 — apt-user/apt-distro 분리(packages/candidates.ts)와
 * 같은 패턴. 시드 자체는 그대로 추천 소스로 남는다. 본체 그룹은 managed
 * 항목만 다루므로(ignore돼 excluded인 항목도 managed였던 적이 있으면 여전히
 * 여기 — SEED 여부와 무관), 두 그룹 중 하나가 비면 그 그룹만 생략한다.
 */
import fs from 'node:fs'
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer, readHostLayer } from '../../manifest'
import { expandHome } from '../../paths'
import { isSubscribed, readSelectionFilter } from '../../selection'
import type { SyncItemGroup } from '../../syncItems'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { KNOWN_DOTFILE_DESCRIPTIONS } from './knownDescriptions'
import { SEED_DOTFILES } from './seed'
import type { DotfileEntry } from './types'

export function buildDotfilesSyncGroup(ctx: RigsyncContext): readonly SyncItemGroup[] {
  const manifest = effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
  const entries = (manifest.entry as DotfileEntry[] | undefined) ?? []
  const managedHomes = new Set(entries.map((e) => e.home))
  const ignore = readIgnoreSet(ctx, 'dotfiles', 'homes')
  // F2: 이 머신의 host 계층에 이미 있는 entry — "이 머신 전용" 배지·토글의
  // 현재 상태 판정용(engine/hostLayerMove.ts가 실제 이동을 수행한다).
  const hostHomes = new Set(
    (
      ((readHostLayer(ctx, DOTFILES_LAYER).entry as DotfileEntry[] | undefined) ??
        []) as DotfileEntry[]
    ).map((e) => e.home)
  )

  const candidateHomes = SEED_DOTFILES.map((s) => s.home).filter(
    (home) => !managedHomes.has(home) && fs.existsSync(expandHome(ctx, home))
  )

  // WS2("창고 모델" 구독): 목록에서 빼지 않고 부착만 한다 — 미구독 항목도
  // 계속 카탈로그로 보인다(창고 모델의 요체).
  const selection = readSelectionFilter(ctx, 'dotfiles')

  const toItem = (home: string): SyncItemGroup['items'][number] => ({
    key: home,
    label: home,
    managed: managedHomes.has(home),
    ignored: ignore.has(home),
    description: KNOWN_DOTFILE_DESCRIPTIONS[home],
    hostOnly: hostHomes.has(home),
    // WS2: 생략=구독(하위 호환) -- 구독일 때는 필드 자체를 안 실어
    // 기존 계약(파일 부재='all' 무마이그레이션)을 그대로 지킨다.
    ...(isSubscribed(selection, home) ? {} : { subscribed: false })
  })

  const groups: SyncItemGroup[] = []
  const managedList = [...managedHomes].sort()
  if (managedList.length > 0) {
    groups.push({ capability: 'dotfiles', title: 'dotfiles', items: managedList.map(toItem) })
  }
  if (candidateHomes.length > 0) {
    groups.push({
      capability: 'dotfiles',
      title: 'dotfiles — 추천 (흔히 동기화하는 dotfiles)',
      subgroup: 'dotfiles-suggested',
      collapsedByDefault: true,
      items: [...candidateHomes].sort().map(toItem)
    })
  }
  return groups
}
