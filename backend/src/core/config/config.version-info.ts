import { logger } from './index';
// @ts-ignore - build-info is auto-generated and might not exist during initial check
import { COMMIT_HASH, PACKAGE_VERSION } from '../../build-info';

export function loadCommitHash(): string | null {
  // Logger call preserved for backward compatibility/debugging, though less useful now
  logger.debug(`Loaded commit hash: ${COMMIT_HASH}`);
  return COMMIT_HASH;
}

export function loadPackageVersion(): string | null {
  logger.debug(`Loaded package version: ${PACKAGE_VERSION}`);
  return PACKAGE_VERSION;
}

export function loadVersionInfo(): void {
  // Values are now statically imported, but we log them for confirmation
  logger.info(`Version Info: v${PACKAGE_VERSION} (${COMMIT_HASH})`);
}

export function getCommitHash(): string | null {
  return COMMIT_HASH;
}

export function getPackageVersion(): string | null {
  return PACKAGE_VERSION;
}