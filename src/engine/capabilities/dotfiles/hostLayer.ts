/**
 * F2 host 계층 이동(docs/refactor-spec-v0.2.md F2, "이 머신 전용" 전환) —
 * dotfiles entry를 common ↔ hosts/<machineId> 사이로 옮긴다. capture(P2에서
 * 이미 host-only entry를 읽어 보존하는 쪽)와 달리, 이건 그 host-only entry를
 * *만드는* 유일한 저작 경로다.
 *
 * store 파일도 함께 옮긴다(git mv 상당) — common의 `dotfiles/...` 대신
 * `hosts/<machineId>/dotfiles/...`로. scheduled capability가 이미 쓰는
 * `hosts/<machineId>/<capability 하위경로>` 관례(store.ts 참조)를 dotfiles에도
 * 적용한 것 — 그래야 host 전용 페이로드가 물리적으로도 공통 풀과 분리되고
 * (P2 이식성 검사·다른 머신으로의 오배포 방지 취지와 일치), 다음 capture가
 * host-only entry를 다시 common 밖으로 잘못 되돌릴 여지가 없다.
 *
 * reference 홈의 심링크(link!==false 엔트리)가 옮기기 전 store 절대경로를
 * 가리키고 있으면, 이동 후 그 심링크가 깨진다 — 그래서 이동 직전 "지금 우리
 * store를 가리키는 심링크인가"를 확인해 두었다가, 페이로드를 옮긴 뒤 새
 * 경로로 재작성한다. link===false 엔트리는 홈이 실파일(copy-mode)이라
 * 애초에 건드리지 않는다.
 *
 * 원자성: 두 layer 파일(hosts/<machineId>/dotfiles.toml, common/dotfiles.toml)
 * 쓰기를 한 함수 안에서 동기적으로 순서대로 수행한다 — Node는 단일 스레드로
 * 동기 fs 호출 사이에 다른 코드가 끼어들 수 없으므로, 두 쓰기 사이의 상태가
 * 밖에서 관찰될 일이 없다(둘 다 끝나야 함수가 반환). 새 위치(대상 layer)를
 * 먼저 쓰고 기존 위치(원본 layer)를 나중에 지우는 순서로 두어, 프로세스가
 * 쓰기 사이에 죽는 최악의 경우에도 항목이 사라지기보다 양쪽에 남는 쪽(복구
 * 가능)이 되게 한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink, safeRealpath } from '../../fsUtil'
import {
  hostLayerPath,
  readCommonLayer,
  readHostLayer,
  writeCommonLayer,
  writeManifestFile,
  type ManifestDocument
} from '../../manifest'
import { expandHome } from '../../paths'
import { HostLayerEntryNotFoundError } from '../hostLayerErrors'
import { DOTFILES_LAYER } from './constants'
import { copyTreeMirror, resolveDotfileStorePath } from './fsTree'
import type { DotfileEntry } from './types'

function entriesOf(doc: ManifestDocument): DotfileEntry[] {
  return (doc.entry as DotfileEntry[] | undefined) ?? []
}

/** home의 `~`/`~/` 접두어를 뗀 상대경로 부분 (capture.ts `seedRelPath`와 동일 규칙). */
function relPathOf(home: string): string {
  return home.startsWith('~/') ? home.slice(2) : home.replace(/^~/, '')
}

function commonDotfileStoreRelPath(home: string): string {
  return `dotfiles/${relPathOf(home)}`
}

function hostDotfileStoreRelPath(ctx: Pick<RigsyncContext, 'machineId'>, home: string): string {
  return `hosts/${ctx.machineId}/dotfiles/${relPathOf(home)}`
}

/**
 * entry의 store 페이로드를 `oldStoreRel` -> `newStoreRel`로 옮기고(존재할
 * 때만 — manifest에만 선언되고 아직 capture 안 된 entry도 있을 수 있다),
 * 그 store를 가리키던 reference 홈 심링크가 있으면 새 경로로 재작성한다.
 */
function moveStoreAndRelink(
  ctx: RigsyncContext,
  entry: DotfileEntry,
  newStoreRel: string
): DotfileEntry {
  const oldAbs = resolveDotfileStorePath(ctx, entry.store)
  const newAbs = resolveDotfileStorePath(ctx, newStoreRel)
  if (oldAbs === null || newAbs === null) {
    throw new Error(`store 경로가 잘못됐습니다 (manifestDir 밖 참조): ${entry.store}`)
  }

  const homePath = expandHome(ctx, entry.home)
  // link===false(copy-mode) 엔트리는 홈이 실파일이라 심링크 재작성 대상이
  // 아니다. link!==false라도 "지금 우리 store를 가리키는 심링크"일 때만
  // 손댄다 — 다른 곳을 가리키거나 깨진 심링크는 이동 연산이 자발적으로
  // 고치지 않는다(capture.ts의 alreadyLinked 판정과 같은 원칙).
  const shouldRelink =
    entry.link !== false && isSymlink(homePath) && safeRealpath(homePath) === path.resolve(oldAbs)

  if (oldAbs !== newAbs && (fs.existsSync(oldAbs) || isSymlink(oldAbs))) {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true })
    copyTreeMirror(oldAbs, newAbs)
    fs.rmSync(oldAbs, { recursive: true, force: true })
  }

  if (shouldRelink) {
    fs.unlinkSync(homePath)
    fs.symlinkSync(path.resolve(newAbs), homePath)
  }

  return { ...entry, store: newStoreRel }
}

function writeHostDotfilesLayer(
  ctx: RigsyncContext,
  hostDoc: ManifestDocument,
  entries: readonly DotfileEntry[]
): void {
  const next: ManifestDocument = { ...hostDoc }
  if (entries.length > 0) next.entry = entries
  else delete next.entry
  writeManifestFile(hostLayerPath(ctx, DOTFILES_LAYER), next)
}

/**
 * dotfiles entry를 common에서 이 머신의 host 계층으로 옮긴다 ("이 머신 전용" 켬).
 *
 * WS5("창고 모델" 전 머신 저작): 예전엔 follower를 거부했지만(role 가드),
 * 이 라운드부터 host 계층 이동은 전 머신에서 허용된다 — capture(저작 10곳,
 * 벌크 capture·심링크 배포·live-edit sweep의 reference 전용은 그대로 유지)와
 * 달리, 이 연산은 단일 entry의 common↔host 재배치일 뿐이라 follower도 안전하게
 * 할 수 있다는 게 이번 배치의 판단(엔진 워커의 `withAuthoredWrite`가 실제
 * commit+push를 role 무관하게 수행한다, transport/sync.ts `syncAuthoredWrite`
 * 참조).
 */
export function moveDotfileEntryToHostLayer(ctx: RigsyncContext, home: string): void {
  const commonDoc = readCommonLayer(ctx, DOTFILES_LAYER)
  const commonEntries = entriesOf(commonDoc)
  const entry = commonEntries.find((e) => e.home === home)
  if (!entry) throw new HostLayerEntryNotFoundError('dotfiles', home)

  const hostDoc = readHostLayer(ctx, DOTFILES_LAYER)
  const hostEntries = entriesOf(hostDoc)

  const movedEntry = moveStoreAndRelink(ctx, entry, hostDotfileStoreRelPath(ctx, home))

  // 대상(host) 먼저 쓰고 원본(common) 나중에 지운다 — 파일 설명 참조.
  writeHostDotfilesLayer(ctx, hostDoc, [...hostEntries, movedEntry])
  const nextCommonEntries = commonEntries.filter((e) => e.home !== home)
  writeCommonLayer(
    ctx,
    DOTFILES_LAYER,
    nextCommonEntries.length > 0 ? { entry: nextCommonEntries } : {}
  )
}

/** dotfiles entry를 이 머신의 host 계층에서 common으로 되돌린다 ("이 머신 전용" 끔). WS5: follower도 허용(위 moveDotfileEntryToHostLayer 참조). */
export function moveDotfileEntryToCommonLayer(ctx: RigsyncContext, home: string): void {
  const hostDoc = readHostLayer(ctx, DOTFILES_LAYER)
  const hostEntries = entriesOf(hostDoc)
  const entry = hostEntries.find((e) => e.home === home)
  if (!entry) throw new HostLayerEntryNotFoundError('dotfiles', home)

  const commonDoc = readCommonLayer(ctx, DOTFILES_LAYER)
  const commonEntries = entriesOf(commonDoc)

  const movedEntry = moveStoreAndRelink(ctx, entry, commonDotfileStoreRelPath(home))

  // 대상(common) 먼저 쓰고 원본(host) 나중에 지운다 — 위와 대칭.
  writeCommonLayer(ctx, DOTFILES_LAYER, { entry: [...commonEntries, movedEntry] })
  const nextHostEntries = hostEntries.filter((e) => e.home !== home)
  writeHostDotfilesLayer(ctx, hostDoc, nextHostEntries)
}
