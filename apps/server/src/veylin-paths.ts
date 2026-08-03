import { homedir } from 'node:os';
import { join } from 'node:path';

/** Canonical ~/.veylin (or VEYLIN_HOME override). */
export function veylinHome(homeDir?: string): string {
  const override = process.env.VEYLIN_HOME?.trim();
  if (override) return override;
  return join(homeDir ?? homedir(), '.veylin');
}

export function veylinSettingsPath(homeDir?: string): string {
  return join(veylinHome(homeDir), 'settings.json');
}

export function veylinSettingsLocalPath(homeDir?: string): string {
  return join(veylinHome(homeDir), 'settings.local.json');
}

export function veylinRulesDir(homeDir?: string): string {
  return join(veylinHome(homeDir), 'rules');
}

export function veylinMcpPath(homeDir?: string): string {
  return join(veylinHome(homeDir), 'mcp.json');
}

export function veylinMcpLocalPath(homeDir?: string): string {
  return join(veylinHome(homeDir), 'mcp.local.json');
}

export function veylinPluginsJsonPath(homeDir?: string): string {
  return join(veylinHome(homeDir), 'plugins.json');
}

export function veylinPluginsDir(homeDir?: string): string {
  return join(veylinHome(homeDir), 'plugins');
}

export function veylinHooksPath(homeDir?: string): string {
  return join(veylinHome(homeDir), 'hooks.json');
}

export function veylinSkillsRoot(homeDir?: string): string {
  return join(veylinHome(homeDir), 'skills');
}
