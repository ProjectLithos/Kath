import * as fs from 'fs';
import * as path from 'path';

/** Shared backend paths/version so project generation and runtime orchestration never drift. */
export const KATH_ROOT = process.env.KATH_ROOT
    ? path.resolve(process.env.KATH_ROOT)
    : path.resolve(__dirname, '..', '..', '..', '..');
export const INU_SDK_ROOT = process.env.INU_SDK_ROOT ? path.resolve(process.env.INU_SDK_ROOT) : path.resolve(KATH_ROOT, '..', 'Inu', 'SDK');
export const KATH_VERSION = fs.readFileSync(path.join(KATH_ROOT, 'VERSION'), 'utf8').trim();
