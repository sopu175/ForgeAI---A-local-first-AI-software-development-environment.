import { describe, expect, it } from 'vitest';
import { sanitizeSubprocessEnv } from '../apps/desktop/src/main/agent/tools';
import { isSecretPath } from '../packages/core/src/scanner';

describe('Security Hardening & Boundary Audit', () => {
  describe('Subprocess Environment Sanitization', () => {
    it('strips API keys, access tokens, and credentials from subprocess env', () => {
      const mockHostEnv: NodeJS.ProcessEnv = {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/home/developer',
        USER: 'developer',
        SHELL: '/bin/zsh',
        TERM: 'xterm-256color',
        AWS_SECRET_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        AWS_ACCESS_KEY_ID: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        GITHUB_TOKEN: 'ghp_exampletoken1234567890',
        OPENAI_API_KEY: 'sk-abcdef1234567890',
        ANTHROPIC_API_KEY: 'sk-ant-1234567890',
        DATABASE_PASSWORD: 'supersecretpassword',
        AUTH_BEARER_TOKEN: 'bearer_token_xyz',
        CUSTOM_SAFE_VAR: 'forgeai-safe-value',
      };

      const sanitized = sanitizeSubprocessEnv(mockHostEnv);

      // Verify system variables remain intact
      expect(sanitized.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
      expect(sanitized.HOME).toBe('/home/developer');
      expect(sanitized.USER).toBe('developer');
      expect(sanitized.CUSTOM_SAFE_VAR).toBe('forgeai-safe-value');

      // Verify sensitive variables are excluded
      expect(sanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(sanitized.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(sanitized.GITHUB_TOKEN).toBeUndefined();
      expect(sanitized.OPENAI_API_KEY).toBeUndefined();
      expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined();
      expect(sanitized.DATABASE_PASSWORD).toBeUndefined();
      expect(sanitized.AUTH_BEARER_TOKEN).toBeUndefined();
    });
  });

  describe('Secret Exclusion in Project Scanner', () => {
    it('reliably excludes credentials, keys, certificates, and dot-env files', () => {
      expect(isSecretPath('.env')).toBe(true);
      expect(isSecretPath('.env.production')).toBe(true);
      expect(isSecretPath('.env.local')).toBe(true);
      expect(isSecretPath('server.key')).toBe(true);
      expect(isSecretPath('cert.pem')).toBe(true);
      expect(isSecretPath('id_rsa')).toBe(true);
      expect(isSecretPath('id_ed25519')).toBe(true);
      expect(isSecretPath('.aws/credentials')).toBe(true);
      expect(isSecretPath('.ssh/known_hosts')).toBe(true);

      // Safe source code files should never be falsely flagged as secrets
      expect(isSecretPath('src/index.ts')).toBe(false);
      expect(isSecretPath('README.md')).toBe(false);
      expect(isSecretPath('components/Button.tsx')).toBe(false);
      expect(isSecretPath('package.json')).toBe(false);
    });
  });
});
