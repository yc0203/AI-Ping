import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = join(__dirname, '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
describe('AI-Ping packaging', () => {
  it('uses its own application identity and installer name', () => {
    expect(pkg.build.appId).toBe('com.aiping.desktop');
    expect(pkg.build.productName).toBe('AI-Ping');
    expect(pkg.build.nsis.artifactName).toBe('AI-Ping-Setup-${version}.exe');
  });
  it('ships both Windows input and selected-text helpers', () => {
    expect(pkg.build.win.extraResources).toEqual(expect.arrayContaining([
      { from: 'native/hook-helper/build/hook-helper.exe', to: 'hook-helper.exe' },
      { from: 'native/text-selection.ps1', to: 'text-selection.ps1' },
    ]));
    expect(readFileSync(join(root, 'native/text-selection.ps1'))[0]).toBe(0xef);
  });
  it('does not publish to the upstream repository', () => {
    expect(pkg.build.publish).toBeUndefined();
    for (const file of readdirSync(join(root, '.github/workflows'))) {
      expect(readFileSync(join(root, '.github/workflows', file), 'utf8')).not.toMatch(/gh release (create|upload|edit)/);
    }
  });
  it('preserves the code license in packaged applications', () => {
    expect(pkg.license).toBe('MIT');
    expect(pkg.build.files).toContain('LICENSE');
    expect(readFileSync(join(root, 'LICENSE'), 'utf8')).toContain('Danrui Meng');
  });
  it('removes its own startup entry when uninstalled', () => {
    const installer = readFileSync(join(root, 'build/installer.nsh'), 'utf8');
    expect(installer).toContain('"com.aiping.desktop"');
    expect(installer).not.toContain('"com.lolping.app"');
  });
});
