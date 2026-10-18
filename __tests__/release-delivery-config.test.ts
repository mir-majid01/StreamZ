import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('release delivery configuration', () => {
  it('keeps release signing separate from the committed debug key', () => {
    const gradle = read('android', 'app', 'build.gradle');

    expect(gradle).toContain('STREAMZ_RELEASE_STORE_FILE');
    expect(gradle).toContain('STREAMZ_RELEASE_STORE_PASSWORD');
    expect(gradle).toContain('STREAMZ_RELEASE_KEY_ALIAS');
    expect(gradle).toContain('STREAMZ_RELEASE_KEY_PASSWORD');
    expect(gradle).toContain('signingConfig signingConfigs.release');
    expect(gradle).toContain('refusing to use android/app/debug.keystore');
    const buildTypes = gradle.slice(gradle.indexOf('buildTypes {'));
    expect(buildTypes).not.toMatch(/release\s*\{[\s\S]*?signingConfig signingConfigs\.debug/);
  });

  it('ships updater source configuration and website fallbacks on the StreamZ repo', () => {
    const env = read('src', 'config', 'env.ts');
    const example = read('.env.example');
    const action = read('.github', 'actions', 'setup-flick', 'action.yml');
    const ci = read('.github', 'workflows', 'android-ci.yml');
    const workflow = read('.github', 'workflows', 'build.yml');
    const website = read('party-server', 'web', 'src', 'components', 'GetAppDialog.tsx');
    const server = read('party-server', 'server.mjs');

    expect(env).toContain("OWNER: process.env.EXPO_PUBLIC_UPDATE_REPO_OWNER?.trim() ?? ''");
    expect(env).toContain("REPO: process.env.EXPO_PUBLIC_UPDATE_REPO_NAME?.trim() ?? ''");
    expect(example).toContain('EXPO_PUBLIC_UPDATE_REPO_OWNER=mir-majid01');
    expect(example).toContain('EXPO_PUBLIC_UPDATE_REPO_NAME=StreamZ');
    expect(action).toContain('default: mir-majid01');
    expect(action).toContain('default: StreamZ');
    expect(ci).toContain('EXPO_PUBLIC_UPDATE_REPO_OWNER=mir-majid01');
    expect(ci).toContain('EXPO_PUBLIC_UPDATE_REPO_NAME=StreamZ');
    expect(workflow).toContain('branches: [main]');
    expect(website).toContain('https://github.com/mir-majid01/StreamZ/releases/latest');
    expect(server).toContain("process.env.EXPO_PUBLIC_UPDATE_REPO_OWNER ||\n  'mir-majid01'");
    expect(server).toContain("process.env.EXPO_PUBLIC_UPDATE_REPO_NAME ||\n  'StreamZ'");
    expect(read('README.md')).toContain('https://github.com/mir-majid01/StreamZ/releases');
    expect(website).not.toContain('sheeshcake/Flickv4/releases/latest');
    expect(server).not.toContain("'sheeshcake'");
  });
});
