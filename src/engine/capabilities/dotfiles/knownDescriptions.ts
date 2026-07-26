/**
 * R6 R2: dotfiles는 apt/flatpak과 달리 "이게 뭔지" 물어볼 시스템 출처가 없다
 * (파일 경로 자체엔 설명이 없다) — 그래서 잘 알려진 파일에 한해 사람이 직접
 * 채운 사전을 쓴다. 여기 없는 경로는 설명 없이 경로만 보여준다(추측 금지 —
 * CLAUDE.md 규율). 키는 `SEED_DOTFILES`/manifest entry와 동일하게 `~/` 축약
 * 표기.
 */
export const KNOWN_DOTFILE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '~/.zshrc': 'zsh 셸 설정',
  '~/.gitconfig': 'git 전역 설정',
  '~/.p10k.zsh': 'Powerlevel10k 프롬프트 설정',
  '~/.ssh/config': 'SSH 호스트 설정',
  '~/.config/wezterm': 'WezTerm 터미널 설정',
  '~/.config/Code/User/settings.json': 'VS Code 설정',
  '~/.config/Code/User/keybindings.json': 'VS Code 키바인딩',
  '~/.claude/settings.json': 'Claude Code 설정',
  '~/.claude/keybindings.json': 'Claude Code 키바인딩',
  '~/.claude/CLAUDE.md': 'Claude Code 전역 지침 파일',
  '~/.claude/agents': 'Claude Code 서브에이전트 정의',
  '~/.claude/skills': 'Claude Code 스킬 정의',
  '~/.claude/output-styles': 'Claude Code 출력 스타일 정의'
} as const
