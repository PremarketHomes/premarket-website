import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const page = readFileSync('src/app/dashboard/office/agents/page.js', 'utf8');

describe('Edit Profile photo cropping reuses the existing cropper', () => {
  it('uses the existing ImagePositioner and crop helpers, and adds no new cropping component', () => {
    expect(page).toContain("import ImagePositioner from '../../../components/ImagePositioner'");
    expect(page).toContain("import { getCroppedImageBlob, blobToFile } from '../../../utils/imageCrop'");
    const components = readdirSync('src/app/components').filter((f) => /crop|position/i.test(f));
    expect(components).toEqual(['ImagePositioner.js']);
  });
  it('picking a photo opens the cropper; the raw file is never saved directly', () => {
    const pick = page.slice(page.indexOf('const pick = (e) =>'), page.indexOf('const reposition'));
    expect(pick).toContain('setPositionerSrc(url)');
    expect(pick).not.toMatch(/setFile\(/);
    expect(pick).not.toMatch(/setPreview\(/);
  });
  it('the CROPPED 480x480 image becomes the file that is uploaded, and the preview shows it', () => {
    const save = page.slice(page.indexOf('const onPositionerSave'), page.indexOf('const save = async'));
    expect(save).toMatch(/getCroppedImageBlob\(positionerSrc, croppedAreaPixels, \{ outputWidth: 480, outputHeight: 480 \}\)/);
    expect(save).toContain('setFile(blobToFile(blob, \'avatar.png\'))');
    expect(save).toContain('setPreview(URL.createObjectURL(blob))');
  });
  it('uses the same round 1:1 settings as the other avatar croppers', () => {
    expect(page).toMatch(/<ImagePositioner[\s\S]*?aspect=\{1\}[\s\S]*?cropShape="round"/);
    expect(readFileSync('src/app/components/AgentModal.js', 'utf8')).toMatch(/aspect=\{1\}[\s\S]*?cropShape="round"/);
  });
  it('storage and permissions are unchanged: same photo route, same multipart field, no server code touched', () => {
    expect(page).toContain("fd.append('file', file)");
    expect(page).toContain('/agent-profile/photo');
    expect(page).toContain("fd.append('key', agent.key)");
  });
});
