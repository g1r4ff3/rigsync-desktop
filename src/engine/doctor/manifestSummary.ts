/**
 * manifest 전체 선언 건수 요약 -- "빈 follower" doctor 체크(아래
 * `emptyFollowerCheck.ts`)가 "capability 전체 합계 0"을 판정하는 데 쓴다.
 * 각 capability의 typed 스키마를 다시 파싱하지 않고, effectiveLayer가
 * 돌려주는 문서의 **최상위 배열 필드 길이를 전부 더하는** 일반적인 방법을
 * 쓴다 -- entry/packages/snap/app/font/path/service/repo 등 필드 이름이
 * capability마다 달라도 전부 최상위 배열이라(패키지 diff/capture 코드로
 * 확인) 이 방식이 스키마 결합 없이 전체를 정확히 센다.
 *
 * scheduled(cron)만 예외 -- TOML manifest 레이어가 아니라 raw 텍스트 파일
 * 스토어(`scheduled/crontab.txt`)라 별도로 다룬다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { APPIMAGE_KEY_FIELDS, APPIMAGE_LAYER } from '../capabilities/appimage/constants'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from '../capabilities/dotfiles/constants'
import { FONTS_KEY_FIELDS, FONTS_LAYER } from '../capabilities/fonts/constants'
import { PACKAGES_KEY_FIELDS, PACKAGES_LAYER } from '../capabilities/packages/constants'
import { REPOS_KEY_FIELDS, REPOS_LAYER } from '../capabilities/repos/constants'
import { SCHEDULED_STORE_REL_PATH } from '../capabilities/scheduled/constants'
import { SERVICES_KEY_FIELDS, SERVICES_LAYER } from '../capabilities/services/constants'
import { SETTINGS_KEY_FIELDS, SETTINGS_LAYER } from '../capabilities/settings/constants'
import { TOOLS_LAYER } from '../capabilities/tools/constants'
import type { RigsyncContext } from '../context'
import { effectiveLayer, type ManifestDocument } from '../manifest'

const TOML_LAYERS: ReadonlyArray<{
  readonly layer: string
  readonly keyFields?: Readonly<Record<string, string>>
}> = [
  { layer: DOTFILES_LAYER, keyFields: DOTFILES_KEY_FIELDS },
  { layer: PACKAGES_LAYER, keyFields: PACKAGES_KEY_FIELDS },
  { layer: APPIMAGE_LAYER, keyFields: APPIMAGE_KEY_FIELDS },
  { layer: FONTS_LAYER, keyFields: FONTS_KEY_FIELDS },
  { layer: SETTINGS_LAYER, keyFields: SETTINGS_KEY_FIELDS },
  { layer: SERVICES_LAYER, keyFields: SERVICES_KEY_FIELDS },
  { layer: REPOS_LAYER, keyFields: REPOS_KEY_FIELDS },
  { layer: TOOLS_LAYER }
]

function countTopLevelArrayEntries(doc: ManifestDocument): number {
  let total = 0
  for (const value of Object.values(doc)) {
    if (Array.isArray(value)) total += value.length
  }
  return total
}

/** 전 capability에 걸쳐 manifest에 선언된 항목 수 총합. */
export function countManifestDeclarations(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'profile'>
): number {
  let total = 0
  for (const { layer, keyFields } of TOML_LAYERS) {
    total += countTopLevelArrayEntries(effectiveLayer(ctx, layer, keyFields))
  }

  const scheduledPath = path.join(ctx.manifestDir, SCHEDULED_STORE_REL_PATH)
  if (fs.existsSync(scheduledPath)) {
    const content = fs.readFileSync(scheduledPath, 'utf-8')
    if (content.split('\n').some((line) => line.trim().length > 0)) total += 1
  }

  return total
}
