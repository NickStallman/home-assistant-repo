import fs from 'fs';
import path from 'path';

// The addon version lives in config.yaml, which sits beside the app both in
// the Home Assistant image and in a standalone checkout
export function getVersion(): string {
  for (const dir of ['../..', '..', '.']) {
    try {
      const config = fs.readFileSync(
        path.resolve(__dirname, dir, 'config.yaml'),
        'utf8'
      );
      const match = config.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
      if (match) {
        return match[1];
      }
    } catch (err) {
      // Try the next location
    }
  }
  return 'unknown';
}
