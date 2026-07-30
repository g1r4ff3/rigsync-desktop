/**
 * tools(npm 전역) 단건 등록 리졸버 — WS4("창고 모델 1차") `registry.ts`가
 * 호출한다. `capture.ts`의 전체 재캡처와 달리 이 머신의 npm 전역 목록에
 * 실제로 있는 패키지 하나만 common 계층 `packages` 배열에 추가(upsert)한다
 * — 기존 `node` 필드는 손대지 않는다(재등록은 그 필드의 진실을 갱신할
 * 이유가 없다, capture만 담당).
 */
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { TOOLS_LAYER } from './constants'
import type { ToolsProvider } from './providerTypes'
import type { ToolsManifest } from './types'

export class ToolPackageNotInstalledError extends Error {
  constructor(readonly packageName: string) {
    super(`${packageName}: 이 머신의 npm 전역 패키지 목록에 없음`)
    this.name = 'ToolPackageNotInstalledError'
  }
}

export async function registerToolPackage(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: ToolsProvider,
  name: string
): Promise<void> {
  const globals = await provider.npmGlobals()
  if (!(name in globals)) throw new ToolPackageNotInstalledError(name)

  const doc = readCommonLayer(ctx, TOOLS_LAYER) as ToolsManifest
  const packages = doc.packages ?? []
  if (packages.includes(name)) return
  writeCommonLayer(ctx, TOOLS_LAYER, { ...doc, packages: [...packages, name].sort() })
}
