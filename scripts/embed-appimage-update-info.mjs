#!/usr/bin/env node
/**
 * `npm run build:linux` 후처리 — 이 프로젝트 자신을 Gear Lever "자동 업데이트
 * 소스 인식" 대상으로 만든다 (실사용 결함: 사용자가 AppImage를 Gear Lever로
 * 통합해도 `[UpdatesNotAvailable]`로 남아 수동으로 `--set-update-source`를
 * 실행해야 했다).
 *
 * **왜 electron-builder의 `publish:` 설정이 아니라 이 스크립트인가** —
 * `electron-builder.yml`의 주석 참조: electron-builder의 AppImage 타깃은
 * `publish` 설정이 있어도 (`app-builder-lib` 소스 트리의 AppImage 타깃 구현 확인)
 * 자기 자신의 electron-updater용 블록맵/`app-update.yml`만 만들 뿐, Gear
 * Lever·AppImageUpdate가 읽는 고전 `.upd_info` ELF 섹션이나 `.zsync` 파일은
 * 전혀 건드리지 않는다. 그래서 이 스크립트가 그 두 산출물을 직접 만든다.
 *
 * 동작 원리(실측, 이 머신의 electron-builder AppImage 툴셋 캐시 안 runtime
 * 스텁으로 확인): electron-builder가 번들하는 AppImage 런타임 스텁은 이미
 * `.upd_info` 섹션을 1024바이트 크기로 예약해 두고 0으로 채워 둔다(appimagetool
 * 자체가 하는 것과 동일한 포맷 — 새 ELF 섹션을 추가하는 게 아니라 이미 있는
 * 섹션의 바이트를 덮어쓰는 것뿐). AppImage type 2는 [runtime 그대로][squashfs]
 * 구조라 완성된 AppImage에서도 이 섹션의 파일 오프셋은 런타임 스텁과 동일하다
 * (`appImageUtil.js`의 `writeRuntimeData`가 런타임을 파일 맨 앞에 그대로 씀).
 * 그래서 `readelf`로 오프셋·크기를 읽어 그 자리에 update-info 문자열을
 * 0-패딩해 쓰면 된다 — 파일 크기·나머지 바이트는 전혀 바뀌지 않는다.
 *
 * `.zsync`는 `zsyncmake`(zsync 패키지) 바이너리가 있어야 생성된다 — 이
 * 개발 머신엔 없어(sudo 설치는 이 스크립트/에이전트가 임의로 하지 않는다)
 * 없으면 경고만 남기고 빌드는 계속 진행한다(release 전 `apt install zsync`
 * 후 수동 실행 경로를 안내).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const distDir = path.join(root, 'dist')

export const UPDATE_SOURCE_OWNER = 'g1r4ff3'
export const UPDATE_SOURCE_REPO = 'rigsync-desktop'

/**
 * `readelf --sections -W <file>` 출력 텍스트에서 `.upd_info` 섹션의 (파일 offset,
 * 크기)를 16진수 필드에서 파싱하는 순수 함수 — exec 호출을 분리해 실제 ELF
 * 파일 없이(고정 텍스트 fixture로) 유닛 테스트 가능하게 한다. 컬럼 순서:
 * `[Nr] Name Type Address Off Size ES Flg Lk Inf Al`.
 */
export function parseUpdInfoSection(readelfSectionsOutput) {
  const line = readelfSectionsOutput.split('\n').find((l) => /\s\.upd_info\s/.test(l))
  if (!line) return null
  const fields = line.trim().split(/\s+/)
  const nameIdx = fields.indexOf('.upd_info')
  if (nameIdx === -1 || fields.length < nameIdx + 4) return null
  const offset = Number.parseInt(fields[nameIdx + 3], 16)
  const size = Number.parseInt(fields[nameIdx + 4], 16)
  if (!Number.isFinite(offset) || !Number.isFinite(size)) return null
  return { offset, size }
}

/** `readelf --sections -W <file>`을 실제로 실행해 {offset, size}를 얻는다 (실 I/O). */
export function findUpdInfoSection(filePath) {
  const out = execFileSync('readelf', ['--sections', '-W', filePath], { encoding: 'utf-8' })
  return parseUpdInfoSection(out)
}

/** `.upd_info` 섹션 바이트를 0-패딩된 update-info 문자열로 덮어쓴다(파일 크기 불변). */
export function embedUpdateInfo(filePath, updateInfoString) {
  const section = findUpdInfoSection(filePath)
  if (!section) {
    throw new Error(
      `${filePath}: .upd_info 섹션을 찾을 수 없음 — electron-builder AppImage 런타임 포맷이 바뀌었을 수 있습니다.`
    )
  }
  const strBuf = Buffer.from(updateInfoString, 'utf-8')
  if (strBuf.length >= section.size) {
    throw new Error(
      `${filePath}: update-info 문자열(${strBuf.length}B)이 .upd_info 섹션(${section.size}B)보다 큽니다.`
    )
  }
  const data = Buffer.alloc(section.size, 0)
  strBuf.copy(data, 0)
  const fd = fs.openSync(filePath, 'r+')
  try {
    fs.writeSync(fd, data, 0, data.length, section.offset)
  } finally {
    fs.closeSync(fd)
  }
}

function zsyncmakeAvailable() {
  try {
    execFileSync('sh', ['-c', 'command -v zsyncmake'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.warn(
      '[embed-appimage-update-info] dist/가 없습니다 — electron-builder --linux를 먼저 실행하세요.'
    )
    return
  }
  const appImages = fs.readdirSync(distDir).filter((f) => f.endsWith('.AppImage'))
  if (appImages.length === 0) {
    console.warn('[embed-appimage-update-info] dist/에 .AppImage가 없습니다.')
    return
  }

  const canZsync = zsyncmakeAvailable()
  if (!canZsync) {
    console.warn(
      '[embed-appimage-update-info] zsyncmake를 찾을 수 없습니다 (zsync 패키지 미설치) — ' +
        '.zsync 파일은 생성하지 않습니다. release 전에 `sudo apt install zsync` 후 아래를 ' +
        '각 AppImage에 대해 수동 실행하세요: zsyncmake -o <file>.AppImage.zsync <file>.AppImage'
    )
  }

  for (const file of appImages) {
    const fullPath = path.join(distDir, file)
    // 파일명에 버전이 박히므로(rigsync-desktop-0.1.4.AppImage) 정확한 이름을 심으면
    // 다음 릴리스에서 asset을 못 찾는다. Gear Lever의 asset 매칭은 fnmatch(glob)라
    // 와일드카드가 유효하다 — 버전 자리를 `*`로 두어 릴리스마다 유지보수가 필요 없게 한다.
    const assetGlob = file.replace(/-\d+\.\d+\.\d+(?=\.AppImage$)/, '-*')
    const updateInfo = `gh-releases-zsync|${UPDATE_SOURCE_OWNER}|${UPDATE_SOURCE_REPO}|latest|${assetGlob}.zsync`
    embedUpdateInfo(fullPath, updateInfo)
    const verify = execFileSync('readelf', ['--string-dump=.upd_info', '--wide', fullPath], {
      encoding: 'utf-8'
    }).trim()
    console.log(`[embed-appimage-update-info] ${file}: embedded update-info`)
    console.log(verify)

    if (canZsync) {
      const zsyncPath = `${fullPath}.zsync`
      execFileSync('zsyncmake', ['-o', zsyncPath, fullPath], { stdio: 'inherit' })
      console.log(`[embed-appimage-update-info] wrote ${path.basename(zsyncPath)}`)
    }
  }
}

// 테스트(embed-appimage-update-info.test.ts)가 findUpdInfoSection/embedUpdateInfo를
// import해서 쓸 수 있도록 main()은 직접 실행될 때만 돈다.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
