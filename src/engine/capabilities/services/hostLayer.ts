/**
 * F2 host 계층 이동(docs/refactor-spec-v0.2.md F2, "이 머신 전용" 전환) —
 * services unit entry를 common ↔ hosts/<machineId> 사이로 옮긴다.
 *
 * dotfiles와 달리 유닛 store 파일(`services/systemd-user/<name>`)은 옮기지
 * 않는다 — cliproxyapi 선례(F1 응급조치로 host 계층에 수동 이동됐던 실제
 * 케이스, capture.ts 주석 참조)가 host entry도 공통 위치의 유닛 파일을 그대로
 * 참조하는 형태였고, captureServices의 host dedup 로직도 그 전제로 짜여 있다
 * (host 오버레이에 있는 unit은 파일은 공통 경로에 이미 쓰고 manifest entry만
 * host로 보낸다 — capture.ts 참조). manifest entry(name/file/enabled)만
 * 옮기면 그 전제와 정확히 대칭이다.
 *
 * 원자성: dotfiles/hostLayer.ts와 같은 원칙 — 대상 layer를 먼저 쓰고 원본
 * layer를 나중에 지운다(동기 fs 호출이라 그 사이 다른 코드가 끼어들 수 없다).
 */
import type { RigsyncContext } from '../../context'
import {
  hostLayerPath,
  readCommonLayer,
  readHostLayer,
  writeCommonLayer,
  writeManifestFile,
  type ManifestDocument
} from '../../manifest'
import { HostLayerEntryNotFoundError } from '../hostLayerErrors'
import { SERVICES_LAYER } from './constants'
import type { ServicesManifest, ServiceUnitEntry } from './types'

function unitsOf(doc: ServicesManifest): readonly ServiceUnitEntry[] {
  return doc.unit ?? []
}

function writeHostServicesLayer(
  ctx: RigsyncContext,
  hostDoc: ServicesManifest,
  units: readonly ServiceUnitEntry[]
): void {
  const next: ManifestDocument = { ...(hostDoc as ManifestDocument) }
  if (units.length > 0) next.unit = units
  else delete next.unit
  writeManifestFile(hostLayerPath(ctx, SERVICES_LAYER), next)
}

/**
 * services unit entry를 common에서 이 머신의 host 계층으로 옮긴다 ("이 머신
 * 전용" 켬). WS5("창고 모델" 전 머신 저작): dotfiles/hostLayer.ts와 동일하게
 * follower도 이 라운드부터 허용(role 가드 제거 — capture 10곳은 그대로 유지).
 */
export function moveServiceEntryToHostLayer(ctx: RigsyncContext, name: string): void {
  const commonDoc = readCommonLayer(ctx, SERVICES_LAYER) as ServicesManifest
  const commonUnits = unitsOf(commonDoc)
  const entry = commonUnits.find((u) => u.name === name)
  if (!entry) throw new HostLayerEntryNotFoundError('services', name)

  const hostDoc = readHostLayer(ctx, SERVICES_LAYER) as ServicesManifest
  const hostUnits = unitsOf(hostDoc)

  // 대상(host) 먼저 쓰고 원본(common) 나중에 지운다.
  writeHostServicesLayer(ctx, hostDoc, [...hostUnits, entry])
  const nextCommonUnits = commonUnits.filter((u) => u.name !== name)
  writeCommonLayer(ctx, SERVICES_LAYER, nextCommonUnits.length > 0 ? { unit: nextCommonUnits } : {})
}

/** services unit entry를 이 머신의 host 계층에서 common으로 되돌린다 ("이 머신 전용" 끔). WS5: follower도 허용(위 참조). */
export function moveServiceEntryToCommonLayer(ctx: RigsyncContext, name: string): void {
  const hostDoc = readHostLayer(ctx, SERVICES_LAYER) as ServicesManifest
  const hostUnits = unitsOf(hostDoc)
  const entry = hostUnits.find((u) => u.name === name)
  if (!entry) throw new HostLayerEntryNotFoundError('services', name)

  const commonDoc = readCommonLayer(ctx, SERVICES_LAYER) as ServicesManifest
  const commonUnits = unitsOf(commonDoc)

  // 대상(common) 먼저 쓰고 원본(host) 나중에 지운다.
  writeCommonLayer(ctx, SERVICES_LAYER, { unit: [...commonUnits, entry] })
  const nextHostUnits = hostUnits.filter((u) => u.name !== name)
  writeHostServicesLayer(ctx, hostDoc, nextHostUnits)
}
