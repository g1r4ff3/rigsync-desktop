/**
 * Manifest = 선언적 동기화 대상(TOML). common/hosts 오버레이 병합
 * (FORWARD.md §3 "manifest 포맷은 TOML 유지"). P0에서는 읽기/쓰기/병합의
 * 시그니처만 세운다 — 실제 TOML 파싱은 P1에서 붙인다.
 */

export interface ManifestDocument {
  readonly [layer: string]: unknown
}

/** common.toml과 hosts/<machine-id>.toml을 읽어 아직 병합하지 않은 원문 조각으로 반환한다. */
export async function readManifest(manifestPath: string): Promise<ManifestDocument> {
  void manifestPath
  throw new Error('readManifest: not implemented yet (P1 walking skeleton)')
}

/** manifest 조각을 TOML로 직렬화해 쓴다. */
export async function writeManifest(manifestPath: string, doc: ManifestDocument): Promise<void> {
  void manifestPath
  void doc
  throw new Error('writeManifest: not implemented yet (P1 walking skeleton)')
}

/**
 * host 오버레이를 common 위에 병합한다. 구 rigsync의 `LAYER_KEY_FIELDS`처럼
 * layer별 key 필드로 array-of-tables를 병합해야 하지만, P0에서는 얕은 병합
 * 자리표시자만 둔다.
 */
export function mergeOverlay(common: ManifestDocument, host: ManifestDocument): ManifestDocument {
  return { ...common, ...host }
}
