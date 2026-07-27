/**
 * 수동 동기화 체크리스트 — 런타임 변이·secret 포함 특성상 rigsync가 자동
 * 동기화할 수 없는 설정(예: Claude Desktop의 skills·plugins·MCP)을 사용자가
 * 수동으로 맞춰야 한다는 것을 Doctor 화면에 표출하기 위한 데이터 리더.
 *
 * `<manifestDir>/common/manual-sync.toml`의 `[[note]]` 배열을 읽는다:
 *
 *   [[note]]
 *   id = "claude-desktop"
 *   title = "Claude Desktop — skills·plugins·MCP"
 *   detail = "여러 줄 설명 텍스트"
 *   exists = "~/.config/Claude"   # 선택 — 이 경로가 이 머신에 있을 때만 노트 표시
 *
 * 내용은 앱이 아니라 manifest 커밋으로 관리한다 — 여기는 렌더링용 데이터만
 * 읽어 반환한다(c65197d portabilityCheck과 같은 "엔진 모듈 → Doctor 배선" 패턴).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../context'
import { commonLayerPath, readManifestFile } from '../manifest'

export interface ManualSyncNote {
  readonly id: string
  readonly title: string
  readonly detail: string
}

interface ManualSyncNoteRaw {
  readonly id?: unknown
  readonly title?: unknown
  readonly detail?: unknown
  /** 선택 — 이 경로(이 머신 기준)가 있을 때만 노트를 표시한다(`~/`는 ctx.homeDir로 확장). */
  readonly exists?: unknown
}

interface ManualSyncManifest {
  readonly note?: readonly ManualSyncNoteRaw[]
}

function expandHome(target: string, homeDir: string): string {
  if (target === '~') return homeDir
  if (target.startsWith('~/')) return path.join(homeDir, target.slice(2))
  return target
}

/**
 * manual-sync.toml의 노트 목록을 읽는다. 파일이 없으면 `[]`.
 *
 * 정보성 기능이라 lenient하게 파싱한다 — id/title/detail 중 하나라도 빠진
 * 엔트리는 조용히 건너뛴다(스키마 오류로 Doctor 전체를 막지 않는다). `exists`가
 * 있으면 이 머신에 그 경로가 없는 노트는 결과에서 제외한다.
 */
export function readManualSyncNotes(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'homeDir'>
): ManualSyncNote[] {
  const doc = readManifestFile(commonLayerPath(ctx, 'manual-sync')) as ManualSyncManifest
  const notes: ManualSyncNote[] = []
  for (const raw of doc.note ?? []) {
    if (
      typeof raw.id !== 'string' ||
      typeof raw.title !== 'string' ||
      typeof raw.detail !== 'string'
    ) {
      continue
    }
    if (typeof raw.exists === 'string') {
      const resolved = expandHome(raw.exists, ctx.homeDir)
      if (!fs.existsSync(resolved)) continue
    }
    notes.push({ id: raw.id, title: raw.title, detail: raw.detail })
  }
  return notes
}
