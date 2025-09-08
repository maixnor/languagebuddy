import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { logger } from '../config';

let commitHash: string | null = null;
let packageVersion: string | null = null;

export function loadCommitHash(): string | null {
  if (commitHash !== null) {
    return commitHash;
  }

  try {
    // Get the short commit hash
    const hash = execSync('git rev-parse --short HEAD', { 
      encoding: 'utf8',
      cwd: process.cwd()
    }).trim();
    
    commitHash = hash;
    logger.info(`Loaded commit hash: ${commitHash}`);
    return commitHash;
  } catch (error) {
    logger.warn('Failed to load commit hash:', error);
    commitHash = 'unknown';
    return commitHash;
  }
}

export function loadPackageVersion(): string | null {
  if (packageVersion !== null) {
    return packageVersion;
  }

  try {
    // Read package.json from the current working directory
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    
    packageVersion = packageJson.version || 'unknown';
    logger.info(`Loaded package version: ${packageVersion}`);
    return packageVersion;
  } catch (error) {
    logger.warn('Failed to load package version:', error);
    packageVersion = 'unknown';
    return packageVersion;
  }
}

export function loadVersionInfo(): void {
  loadCommitHash();
  loadPackageVersion();
}

export function getCommitHash(): string | null {
  return commitHash;
}

export function getPackageVersion(): string | null {
  return packageVersion;
}
