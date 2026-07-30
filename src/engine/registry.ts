/**
 * WS4("창고 모델 1차" — cheerful-growing-fairy 계획) 등록 엔진 — "등록"이라는
 * 새 쓰기 동작의 dispatcher. capability별 실제 리졸버는 각 capability
 * 폴더의 `register.ts`에 있다(`hostLayerMove.ts` 관례 — 이 파일은 라우팅 +
 * 자동 구독/구독 흔적 정리만 한다).
 *
 * `registerEntry`: 라이브 시스템에서 1건 조회 → manifest common 계층에
 * upsert(read-modify-write) → 자동 구독 보장. 자동 구독은 `selection.ts`의
 * `setSubscribed(ctx, capability, key, true)` 한 호출로 처리된다 —
 * mode='select'면 include에 추가, mode='all'이면 exclude에서 제거(있었다면)
 * 하는 두 갈래를 그 함수가 이미 알고 있다(`registry.test.ts`가 두 모드 다
 * 단언). dotfiles는 이번 배치에서 **기존 엔트리의 재캡처(upsert)만**
 * 지원한다(신규 임의 경로 등록은 WS6) — manifest에 없는 home으로 호출되면
 * `DotfileEntryNotRegisteredError`를 던진다(무시하지 않는다).
 *
 * `unregisterEntry`: common+host 양쪽에서 이 key의 엔트리를 제거한다
 * (dotfiles는 store payload도 — 그 capability의 register.ts가 "엔트리
 * 먼저, payload 나중" 순서를 스스로 지킨다). **홈의 실제 파일·설치물은
 * 절대 건드리지 않는다** — 카탈로그(manifest) 제외는 로컬 시스템 삭제가
 * 아니다. 이 머신의 selection에서도 이 key의 흔적을 지우지만, **다른
 * 머신의 selection에 남은 include/exclude는 이 함수가 건드릴 수 없다**
 * (host별 파일이라 접근할 이유가 없다) — 무해한 죽은 데이터로 남는다(같은
 * key가 나중에 다시 등록되면 그 머신은 예전 구독 의사대로 재활성화될 뿐,
 * 삭제 의미론과는 무관하다는 뜻 — UI의 삭제 확인 다이얼로그가
 * `listEntrySubscribers`로 이 사실을 안내한다).
 */
import { registerAppimageEntry } from './capabilities/appimage/register'
import { APPIMAGE_LAYER } from './capabilities/appimage/constants'
import type { GearLeverProvider } from './capabilities/appimage/providerTypes'
import { registerDotfileEntry, unregisterDotfileEntry } from './capabilities/dotfiles/register'
import { FONTS_LAYER } from './capabilities/fonts/constants'
import { registerFontEntry } from './capabilities/fonts/register'
import { PACKAGES_LAYER } from './capabilities/packages/constants'
import { registerAptPackage, registerFlatpakApp } from './capabilities/packages/register'
import type { PackageProviders } from './capabilities/packages/providerTypes'
import { REPOS_LAYER } from './capabilities/repos/constants'
import { registerRepoEntry } from './capabilities/repos/register'
import type { GitProvider } from './capabilities/repos/providerTypes'
import { TOOLS_LAYER } from './capabilities/tools/constants'
import { registerToolPackage } from './capabilities/tools/register'
import type { ToolsProvider } from './capabilities/tools/providerTypes'
import type { RigsyncContext } from './context'
import {
  hostLayerPath,
  readCommonLayer,
  readHostLayer,
  writeCommonLayer,
  writeManifestFile,
  type ManifestDocument
} from './manifest'
import { readSelectionMode, setSubscribed } from './selection'

export type RegisterCapability =
  'apt' | 'flatpak' | 'appimage' | 'fonts' | 'tools' | 'repos' | 'dotfiles'

export interface RegisterEntryDeps {
  readonly packages: PackageProviders
  readonly gearLever: GearLeverProvider
  readonly tools: ToolsProvider
  readonly git: GitProvider
}

/**
 * 이 머신의 selection에서 이 key의 명시적 흔적을 지운다 — 현재 모드의
 * 활성 목록만 건드리는 `setSubscribed`의 성질을 그대로 이용한다: select
 * 모드에선 include에서 빼는 게 "흔적 제거"(subscribed=false), all
 * 모드에선 exclude에서 빼는 게 "흔적 제거"(subscribed=true) — 두 모드가
 * 정반대 인자를 요구하므로 여기서 모드를 먼저 읽어 분기한다.
 */
function clearSelectionTrace(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  capability: RegisterCapability,
  key: string
): void {
  const mode = readSelectionMode(ctx)
  setSubscribed(ctx, capability, key, mode !== 'select')
}

export async function registerEntry(
  ctx: RigsyncContext,
  deps: RegisterEntryDeps,
  capability: RegisterCapability,
  key: string
): Promise<void> {
  switch (capability) {
    case 'apt':
      await registerAptPackage(ctx, deps.packages.apt, key)
      break
    case 'flatpak':
      await registerFlatpakApp(ctx, deps.packages.flatpak, key)
      break
    case 'appimage':
      await registerAppimageEntry(ctx, deps.gearLever, key)
      break
    case 'fonts':
      registerFontEntry(ctx, key)
      break
    case 'tools':
      await registerToolPackage(ctx, deps.tools, key)
      break
    case 'repos':
      await registerRepoEntry(ctx, deps.git, key)
      break
    case 'dotfiles':
      registerDotfileEntry(ctx, key)
      break
  }
  setSubscribed(ctx, capability, key, true)
}

interface ManifestArrayLocation {
  readonly layer: string
  /** doc 안 경로 — 길이 1(최상위 배열, 예: `[[app]]`) 또는 2(섹션.배열, 예: packages.toml의 `[apt] packages`/`[flatpak] app`). */
  readonly path: readonly [string] | readonly [string, string]
  /** null = 문자열 스칼라 배열(예: apt packages/tools packages). 아니면 이 필드로 매칭. */
  readonly keyField: string | null
}

const REMOVE_LOCATION: Readonly<
  Record<Exclude<RegisterCapability, 'dotfiles'>, ManifestArrayLocation>
> = {
  apt: { layer: PACKAGES_LAYER, path: ['apt', 'packages'], keyField: null },
  flatpak: { layer: PACKAGES_LAYER, path: ['flatpak', 'app'], keyField: 'application' },
  appimage: { layer: APPIMAGE_LAYER, path: ['app'], keyField: 'name' },
  fonts: { layer: FONTS_LAYER, path: ['font'], keyField: 'name' },
  tools: { layer: TOOLS_LAYER, path: ['packages'], keyField: null },
  repos: { layer: REPOS_LAYER, path: ['repo'], keyField: 'path' }
}

function removeFromArray(
  arr: readonly unknown[],
  keyField: string | null,
  key: string
): { next: unknown[]; removed: boolean } {
  const next =
    keyField === null
      ? (arr as string[]).filter((v) => v !== key)
      : (arr as ManifestDocument[]).filter((v) => v[keyField] !== key)
  return { next, removed: next.length !== arr.length }
}

function removeFromDoc(
  doc: ManifestDocument,
  loc: ManifestArrayLocation,
  key: string
): { next: ManifestDocument; removed: boolean } {
  if (loc.path.length === 1) {
    const [arrayKey] = loc.path
    const arr = doc[arrayKey] as unknown[] | undefined
    if (!arr) return { next: doc, removed: false }
    const { next: filtered, removed } = removeFromArray(arr, loc.keyField, key)
    if (!removed) return { next: doc, removed: false }
    const next: ManifestDocument = { ...doc }
    if (filtered.length > 0) next[arrayKey] = filtered
    else delete next[arrayKey]
    return { next, removed: true }
  }

  const [sectionKey, arrayKey] = loc.path
  const section = (doc[sectionKey] as ManifestDocument | undefined) ?? {}
  const arr = section[arrayKey] as unknown[] | undefined
  if (!arr) return { next: doc, removed: false }
  const { next: filtered, removed } = removeFromArray(arr, loc.keyField, key)
  if (!removed) return { next: doc, removed: false }
  const nextSection: ManifestDocument = { ...section }
  if (filtered.length > 0) nextSection[arrayKey] = filtered
  else delete nextSection[arrayKey]
  const next: ManifestDocument = { ...doc }
  if (Object.keys(nextSection).length > 0) next[sectionKey] = nextSection
  else delete next[sectionKey]
  return { next, removed: true }
}

export function unregisterEntry(
  ctx: RigsyncContext,
  capability: RegisterCapability,
  key: string
): void {
  if (capability === 'dotfiles') {
    unregisterDotfileEntry(ctx, key)
    clearSelectionTrace(ctx, capability, key)
    return
  }

  const loc = REMOVE_LOCATION[capability]

  const commonDoc = readCommonLayer(ctx, loc.layer)
  const { next: nextCommon, removed: removedCommon } = removeFromDoc(commonDoc, loc, key)
  if (removedCommon) writeCommonLayer(ctx, loc.layer, nextCommon)

  const hostDoc = readHostLayer(ctx, loc.layer)
  const { next: nextHost, removed: removedHost } = removeFromDoc(hostDoc, loc, key)
  if (removedHost) writeManifestFile(hostLayerPath(ctx, loc.layer), nextHost)

  clearSelectionTrace(ctx, capability, key)
}
