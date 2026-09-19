import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      // __BUILD_INFO__ lo inyecta Vite en tiempo de build (ver vite.config.js).
      globals: { ...globals.browser, __BUILD_INFO__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // Sin esto, `no-unused-vars` no ve el JSX: un import usado solo como
      // etiqueta (`<motion.div>`) se reportaba como no usado. El
      // `varsIgnorePattern` en mayúsculas lo tapaba para los componentes, pero
      // dejaba fuera los que empiezan por minúscula — y, de paso, escondía los
      // imports de componente que sí sobran.
      'react/jsx-uses-vars': 'error',
      // La contraria de la anterior, y la que de verdad faltaba: `no-undef` NO
      // mira los nombres de las etiquetas JSX, así que un `<Card>` sin importar
      // pasaba el lint y el build y solo reventaba al renderizar en el navegador
      // ("Card is not defined"). Esta regla sí lo ve.
      'react/jsx-no-undef': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
    },
  },
  {
    // Código de servidor y de build (serverless, proxy dev, scripts): entorno Node.
    files: ['api/**/*.js', 'server.js', 'scripts/**/*.{js,mjs}', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
])
