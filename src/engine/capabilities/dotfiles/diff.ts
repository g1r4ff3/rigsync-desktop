/**
 * dotfiles diff: manifest와 홈의 현재 상태를 비교한다(읽기 전용 — 부작용
 * 없음). 구 repo `diff_dotfiles` 행동을 옮긴 것(코드 복사 아님).
 *
 * F3/D2-b: 판정은 role(ctx.role)에 따라 갈린다 — reference는 entry.link를
 * 그대로 따르고, follower는 entry.link 값과 무관하게 항상 link=false 의미론
 * (복사 배포)으로 판정한다. 그래서 follower의 toLink는 항상 빈 배열이다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink, safeRealpath } from '../../fsUtil'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { expandHome } from '../../paths'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { dirsEqual, resolveDotfileStorePath } from './fsTree'
import type { DiffReport, DotfileEntry } from './types'

export async function diffDotfiles(ctx: RigsyncContext): Promise<DiffReport> {
  const manifest = effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
  const entries = (manifest.entry as DotfileEntry[] | undefined) ?? []
  const ignoreHomes = readIgnoreSet(ctx, 'dotfiles', 'homes')

  const toLink: string[] = []
  const contentChanged: string[] = []
  const missingHome: string[] = []
  const invalidStore: string[] = []

  for (const entry of entries) {
    if (ignoreHomes.has(entry.home)) continue

    const homePath = expandHome(ctx, entry.home)
    const storePath = resolveDotfileStorePath(ctx, entry.store)
    if (storePath === null) {
      invalidStore.push(entry.home)
      continue
    }

    const homeExists = fs.existsSync(homePath)
    const homeIsSymlink = isSymlink(homePath)
    if (!homeExists && !homeIsSymlink) {
      missingHome.push(entry.home)
      continue
    }

    // follower는 entry.link 값과 무관하게 항상 link=false(복사 배포) 의미론으로
    // 판정한다 (F3/D2-b — 이미지 스냅샷 모델: manifest는 reference를 촬영한
    // 원판, follower 홈 파일은 그 배포 결과물이어야 한다. 심링크는 원판으로의
    // 라이브 뷰라서 follower의 로컬 편집이 store를 직접 오염시켜 pull을
    // 깨뜨린다 — reference에서는 같은 심링크가 촬영 파이프라인이라 유지한다).
    const effectiveLink = ctx.role === 'follower' ? false : entry.link

    if (effectiveLink !== false) {
      if (homeIsSymlink) {
        const real = safeRealpath(homePath)
        if (real === path.resolve(storePath)) continue
      }
      toLink.push(entry.home)
      continue
    }

    // link=false 엔트리의 홈이 심링크면 실파일 전환이 필요하다 — 내용 비교는
    // 심링크를 따라가 "같음"이 되므로 여기서 먼저 잡는다 (link=true → false
    // 전환 시나리오: 심링크가 남으면 로컬 편집이 store를 계속 오염시킨다).
    if (homeIsSymlink) {
      contentChanged.push(entry.home)
      continue
    }

    let same = false
    try {
      same =
        entry.type === 'dir'
          ? dirsEqual(homePath, storePath)
          : fs.readFileSync(homePath).equals(fs.readFileSync(storePath))
    } catch {
      same = false
    }
    if (!same) contentChanged.push(entry.home)
    if (entry.mode && homeExists && fs.statSync(homePath).isFile()) {
      const curMode = (fs.statSync(homePath).mode & 0o777).toString(8)
      if (curMode !== entry.mode) {
        contentChanged.push(`${entry.home} (mode ${curMode} != ${entry.mode})`)
      }
    }
  }

  return { capability: 'dotfiles', toLink, contentChanged, missingHome, invalidStore }
}
