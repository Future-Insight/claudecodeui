import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.{js,jsx,ts,tsx}', 'server/**/*.{js,jsx,ts,tsx}',],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true
                }
            },
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                navigator: 'readonly',
                fetch: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                FormData: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                prompt: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                Blob: 'readonly',
                WebSocket: 'readonly',
                Event: 'readonly',
                CustomEvent: 'readonly',
                MediaRecorder: 'readonly',
                IntersectionObserver: 'readonly',
                ResizeObserver: 'readonly',
                location: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                global: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly'
            }
        },
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooksPlugin
        },
        settings: {
            react: {
                version: 'detect'
            }
        },
        rules: {
            ...reactPlugin.configs.recommended.rules,
            ...reactHooksPlugin.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/display-name': 'off',
            'react/no-unescaped-entities': 'off',
            'react-hooks/exhaustive-deps': 'off',
            'no-unused-vars': 'off',
            'no-undef': 'error',
            'no-case-declarations': 'off',
            'no-control-regex': 'off',
            'no-empty': 'off'
        }
    }
];