/**
 * doctor의 checks 레이어(file/apt/cmd)가 실제 시스템을 조회하는 Linux 구현. 구 repo
 * `evaluate_check`/`probe_dpkg_installed`/`probe_shell_cmd`(rigsync.py:650-673,
 * 1911-1951) 행동 이식. `fileMatches`는 와일드카드(`*`/`?`/`[`)가 있으면
 * `fs.globSync`(Node 22+)를 쓰고, 없으면 단순 존재 확인으로 충분하다(구 repo
 * seed 체크들은 전부 리터럴 경로 -- `docs/package-policy.md` 범위 밖의 과설계를
 * 피한다).
 */
import fs from 'node:fs'
import type { DoctorSystemProvider, ShellCheckResult } from '../../doctor/providerTypes'
import { run } from './exec'

const GLOB_META = /[*?[]/

export class LinuxDoctorSystemProvider implements DoctorSystemProvider {
  fileMatches(expandedTarget: string): string[] {
    if (GLOB_META.test(expandedTarget)) {
      const globSync = (fs as unknown as { globSync?: (pattern: string) => string[] }).globSync
      if (typeof globSync === 'function') {
        try {
          return globSync(expandedTarget)
        } catch {
          return []
        }
      }
    }
    return fs.existsSync(expandedTarget) ? [expandedTarget] : []
  }

  isAptPackageInstalled(pkg: string): boolean {
    const result = run(['dpkg', '-s', pkg])
    return result.code === 0
  }

  runShellCmd(cmdString: string): ShellCheckResult {
    const result = run(['bash', '-c', cmdString], 15_000)
    return { code: result.code, combinedOutput: result.stdout + result.stderr }
  }
}
