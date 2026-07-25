/**
 * capture가 manifest에 아직 없을 때 자동으로 후보로 얹는 잘 알려진 dotfile
 * 목록. 구 repo `~/repos/rigsync/rigsync.py`의 `SEED_DOTFILES` 데이터를 그대로
 * 옮김 — 이건 알고리즘이 아니라 "이 사용자 머신에서 무엇을 동기화 대상으로
 * 볼지"를 정의하는 도메인 데이터라 리터럴 승계가 맞다(FORWARD.md "구 repo …
 * 행동만 캐다 씀"의 대상).
 */
import type { DotfileEntry } from './types'

export interface SeedDotfile {
  readonly home: string
  readonly type: DotfileEntry['type']
  readonly link: boolean
  readonly mode?: string
}

export const SEED_DOTFILES: readonly SeedDotfile[] = [
  { home: '~/.zshrc', type: 'file', link: true },
  { home: '~/.p10k.zsh', type: 'file', link: true },
  { home: '~/.gitconfig', type: 'file', link: true },
  { home: '~/.ssh/config', type: 'file', link: false, mode: '600' },
  { home: '~/.config/wezterm', type: 'dir', link: true },
  { home: '~/.config/Code/User/settings.json', type: 'file', link: true },
  { home: '~/.config/Code/User/keybindings.json', type: 'file', link: true },
  { home: '~/.config/Code/User/chatLanguageModels.json', type: 'file', link: true },
  { home: '~/.claude/settings.json', type: 'file', link: true },
  { home: '~/.claude/keybindings.json', type: 'file', link: true },
  { home: '~/.claude/CLAUDE.md', type: 'file', link: true },
  { home: '~/.claude/agents', type: 'dir', link: true },
  { home: '~/.claude/skills', type: 'dir', link: true },
  { home: '~/.claude/output-styles', type: 'dir', link: true },
  { home: '~/.local/bin/sync-claude-to-opencode.sh', type: 'file', link: true }
]
