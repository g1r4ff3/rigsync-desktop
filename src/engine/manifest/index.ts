/**
 * Manifest = 선언적 동기화 대상(TOML), common/hosts 오버레이 병합
 * (FORWARD.md §3). 레이아웃은 구 repo `~/repos/rigsync/rigsync.py`의
 * `Config`/`merge_layer`/`read_toml`/`write_toml` 행동을 옮긴 것(코드 복사
 * 아님 — git 저장소 없이 순수 로컬 디렉터리로 다룬다, P1 확정 결정 ①):
 *
 *   <manifestDir>/common/<layer>.toml           -- 공통(호스트 무관) 선언
 *   <manifestDir>/hosts/<machineId>/<layer>.toml -- 호스트별 오버레이
 *   <manifestDir>/dotfiles/...                   -- capability별 파일 스토어
 *
 * TOML 파싱/직렬화는 smol-toml (parse+stringify 둘 다 필요 — 코디네이터 권장).
 */
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from 'smol-toml'
import type { RigsyncContext } from '../context'

/**
 * capability 도메인 타입(예: DotfileEntry)이 smol-toml의 정확한 `TomlValue`
 * 유니온(index signature 포함)을 만족할 필요는 없으므로, TomlTable보다 느슨한
 * `Record<string, unknown>`로 둔다. smol-toml과의 경계(parse/stringify)에서만
 * 캐스팅한다.
 */
export type ManifestDocument = Record<string, unknown>

export function commonLayerPath(ctx: Pick<RigsyncContext, 'manifestDir'>, layer: string): string {
  return path.join(ctx.manifestDir, 'common', `${layer}.toml`)
}

export function hostLayerPath(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  layer: string
): string {
  return path.join(ctx.manifestDir, 'hosts', ctx.machineId, `${layer}.toml`)
}

/** P2c profiles 계층: `<manifestDir>/profiles/<profile>/<layer>.toml`. */
export function profileLayerPath(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  profile: string,
  layer: string
): string {
  return path.join(ctx.manifestDir, 'profiles', profile, `${layer}.toml`)
}

/** manifest TOML 파일을 읽는다. 파일이 없으면 빈 문서({})를 반환한다. */
export function readManifestFile(filePath: string): ManifestDocument {
  if (!fs.existsSync(filePath)) return {}
  return parseToml(fs.readFileSync(filePath, 'utf-8')) as ManifestDocument
}

/** manifest TOML 파일을 쓴다(부모 디렉터리 자동 생성). */
export function writeManifestFile(filePath: string, doc: ManifestDocument): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, stringifyToml(doc as unknown as TomlTable))
}

/** common/<layer>.toml만 읽는다 (호스트 오버레이 미병합 — capture의 baseline). */
export function readCommonLayer(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  layer: string
): ManifestDocument {
  return readManifestFile(commonLayerPath(ctx, layer))
}

export function writeCommonLayer(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  layer: string,
  doc: ManifestDocument
): void {
  writeManifestFile(commonLayerPath(ctx, layer), doc)
}

export function readHostLayer(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  layer: string
): ManifestDocument {
  return readManifestFile(hostLayerPath(ctx, layer))
}

/** ctx.profile이 없으면 빈 문서(프로필 단계 스킵 — 하위 호환). */
export function readProfileLayer(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'profile'>,
  layer: string
): ManifestDocument {
  if (!ctx.profile) return {}
  return readManifestFile(profileLayerPath(ctx, ctx.profile, layer))
}

/**
 * host 오버레이를 common 위에 병합한다 (구 repo `merge_layer`의 행동 이식):
 * - 문자열 배열: 합집합, 정렬
 * - table 배열(array-of-tables): `keyFields[layerKey]` 필드를 키로 병합 —
 *   common 순서가 먼저, host에만 있는 키는 뒤에 추가, 같은 키는 host가 이긴다
 * - 스칼라: host가 이긴다
 * - 중첩 객체: 재귀 병합
 */
export function mergeLayer(
  common: ManifestDocument | undefined,
  host: ManifestDocument | undefined,
  keyFields: Readonly<Record<string, string>> = {}
): ManifestDocument {
  const c = common ?? {}
  const h = host ?? {}
  if (Object.keys(c).length === 0) return h
  if (Object.keys(h).length === 0) return c

  const keys: string[] = [...Object.keys(c)]
  for (const k of Object.keys(h)) {
    if (!keys.includes(k)) keys.push(k)
  }

  const result: ManifestDocument = {}
  for (const k of keys) {
    const cv = c[k]
    const hv = h[k]
    if (!(k in c)) {
      result[k] = hv
    } else if (!(k in h)) {
      result[k] = cv
    } else if (isPlainTable(cv) && isPlainTable(hv)) {
      result[k] = mergeLayer(cv, hv, keyFields)
    } else if (Array.isArray(cv) && Array.isArray(hv)) {
      const isTableArray =
        (cv.length > 0 && isPlainTable(cv[0])) ||
        (hv.length > 0 && isPlainTable(hv[0])) ||
        k in keyFields
      if (isTableArray) {
        const keyField = keyFields[k] ?? 'name'
        const merged = new Map<unknown, ManifestDocument>()
        const order: unknown[] = []
        for (const item of cv as ManifestDocument[]) {
          const kk = item[keyField]
          if (!merged.has(kk)) order.push(kk)
          merged.set(kk, item)
        }
        for (const item of hv as ManifestDocument[]) {
          const kk = item[keyField]
          if (!merged.has(kk)) order.push(kk)
          merged.set(kk, item)
        }
        result[k] = order.map((kk) => merged.get(kk))
      } else {
        result[k] = [...new Set([...(cv as unknown[]), ...(hv as unknown[])])].sort()
      }
    } else {
      result[k] = hv // 스칼라 -> host가 이긴다
    }
  }
  return result
}

function isPlainTable(v: unknown): v is ManifestDocument {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * common → profile → host 3단을 병합한 유효(effective) manifest 레이어
 * (FORWARD.md §7 "profiles 계층"). `ctx.profile`이 없으면 profile 단계가
 * 빈 문서라 사실상 기존 common→host 2단과 동일하다(하위 호환 — mergeLayer는
 * 빈 문서를 그냥 통과시킨다).
 */
export function effectiveLayer(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'profile'>,
  layer: string,
  keyFields: Readonly<Record<string, string>> = {}
): ManifestDocument {
  const common = readCommonLayer(ctx, layer)
  const profile = readProfileLayer(ctx, layer)
  const host = readHostLayer(ctx, layer)
  return mergeLayer(mergeLayer(common, profile, keyFields), host, keyFields)
}
