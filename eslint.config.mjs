import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn/ui가 `shadcn add`로 생성한 벤더 코드 -- house style을 맞추려고
    // 손으로 고치면 다음 `add`/업데이트 때마다 다시 어긋난다. 이 두 규칙만 끈다.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // @electron-toolkit/eslint-config-ts가 이미 최상위 `*.js`/`*.mjs`에는
    // explicit-function-return-type을 꺼주지만, 그 패턴은 서브디렉터리(예:
    // scripts/*.mjs)까지 안 내려온다 -- 1회성 Node 유틸 스크립트라 TS 프로젝트가
    // 아니므로 같은 취지를 여기서도 명시적으로 켠다.
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
