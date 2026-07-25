/**
 * `gearlever.conf`용 최소 INI 파서 — **읽기 전용**(정책: "설정 파일 직접 쓰기
 * 금지 — write는 CLI로만", write를 아예 이 모듈에 두지 않는다). 실측 형식:
 *
 * ```
 * [DEFAULT]
 * fetch-updates-in-background = no
 *
 * [app.<md5-hex>]
 * name = tev
 * file_path = /home/cglab/AppImages/tev.appimage
 *
 * [app.<md5-hex>.update_manager]
 * repo = Tom94/tev
 * repo_filename = tev.appimage
 * allow_prereleases = False
 * manager = GithubUpdater
 * ```
 *
 * 섹션 이름의 `<md5-hex>`는 AppImage 절대경로의 MD5 hex digest다(실측 확인 —
 * `md5("/home/cglab/AppImages/tev.appimage")`가 실제 섹션 해시와 일치). 이게
 * `--list-installed --json`의 `path` 필드와 이 파일을 잇는 유일한 조인 키다
 * (JSON에는 좌표가 없다 — FORWARD.md §7).
 */
import crypto from 'node:crypto'

export type IniDocument = Record<string, Record<string, string>>

export function parseIni(text: string): IniDocument {
  const doc: IniDocument = {}
  let currentSection: string | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const sectionMatch = /^\[(.+)\]$/.exec(line)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      doc[currentSection] ??= {}
      continue
    }

    if (currentSection === null) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    doc[currentSection][key] = value
  }

  return doc
}

/** AppImage 절대경로 -> gearlever.conf 섹션 해시(md5 hex). */
export function gearleverConfigHash(appImagePath: string): string {
  return crypto.createHash('md5').update(appImagePath).digest('hex')
}
