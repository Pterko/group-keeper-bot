import fs from 'node:fs';

export default function chooseValidPath(paths: string[]): string {
  for (const path of paths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  throw new Error(`Unable to find valid path, provided array: ${paths.join(', ')}`);
}