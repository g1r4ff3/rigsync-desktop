/**
 * dotfiles capture/apply가 공유하는 파일트리 유틸. 구 repo
 * `_dotfile_store_path`/`_copy_tree_mirror`/`_dirs_equal`/`_safe_copy` 행동을
 * 옮긴 것(코드 복사 아님).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink } from '../../fsUtil'

/**
 * manifest의 `store` 필드(예: "dotfiles/.zshrc")를 manifestDir 기준 절대경로로
 * 푼다. 절대경로이거나 manifestDir을 벗어나는(`../`) 값은 안전하지 않으므로
 * null을 반환한다 — 호출부는 이 경우 "store escapes repo root"로 거부해야 한다.
 */
export function resolveDotfileStorePath(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  store: string
): string | null {
  if (!store || path.isAbsolute(store)) return null
  const manifestRoot = path.resolve(ctx.manifestDir)
  const resolved = path.resolve(ctx.manifestDir, store)
  const rel = path.relative(manifestRoot, resolved)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return resolved
}

function isDanglingSymlink(p: string): boolean {
  return isSymlink(p) && !fs.existsSync(p)
}

/**
 * safeCopy(src,dst)의 TS 버전: 대상이 시스템 소유 read-only(예: apt keyring)
 * 여도 다음 capture에서 다시 덮어쓸 수 있도록 u+w를 보장한다.
 */
function safeCopyFile(src: string, dst: string): void {
  if (fs.existsSync(dst)) {
    try {
      fs.chmodSync(dst, fs.statSync(dst).mode | fs.constants.S_IWUSR)
    } catch {
      // 권한 변경 실패는 무시 -- copyFileSync가 그대로 실패하면 그 에러가 표면화된다.
    }
  }
  fs.copyFileSync(src, dst)
  try {
    fs.chmodSync(dst, fs.statSync(dst).mode | fs.constants.S_IWUSR)
  } catch {
    // 무시
  }
}

/**
 * src(파일 또는 디렉터리)를 dst로 미러링한다 — dst가 src와 정확히 같아지도록
 * (디렉터리면 dst에만 있는 여분 항목을 제거한다). 트리 안 어디든 끊어진
 * symlink(dangling)가 있으면 통째로 실패시키지 않고 건너뛰고 경로를 모아
 * 반환한다.
 */
export function copyTreeMirror(src: string, dst: string): string[] {
  const skipped: string[] = []
  copyTreeMirrorInto(src, dst, skipped)
  return skipped
}

function copyTreeMirrorInto(src: string, dst: string, skipped: string[]): void {
  if (isDanglingSymlink(src)) {
    skipped.push(src)
    return
  }
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    const srcNames = new Set(fs.readdirSync(src))
    if (fs.existsSync(dst)) {
      for (const name of fs.readdirSync(dst)) {
        if (!srcNames.has(name)) {
          const target = path.join(dst, name)
          const targetIsDir = fs.lstatSync(target).isDirectory() && !isSymlink(target)
          if (targetIsDir) {
            fs.rmSync(target, { recursive: true, force: true })
          } else {
            fs.unlinkSync(target)
          }
        }
      }
    }
    for (const name of srcNames) {
      copyTreeMirrorInto(path.join(src, name), path.join(dst, name), skipped)
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    safeCopyFile(src, dst)
  }
}

/** 두 디렉터리가 이름·구조·내용까지 완전히 같은지 재귀 비교한다. */
export function dirsEqual(a: string, b: string): boolean {
  if (!isDir(a) || !isDir(b)) return false
  const aNames = fs.readdirSync(a).sort()
  const bNames = fs.readdirSync(b).sort()
  if (aNames.length !== bNames.length || aNames.some((n, i) => n !== bNames[i])) return false
  for (const name of aNames) {
    const pa = path.join(a, name)
    const pb = path.join(b, name)
    const paDir = isDir(pa)
    const pbDir = isDir(pb)
    if (paDir !== pbDir) return false
    if (paDir) {
      if (!dirsEqual(pa, pb)) return false
    } else if (!fs.readFileSync(pa).equals(fs.readFileSync(pb))) {
      return false
    }
  }
  return true
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
