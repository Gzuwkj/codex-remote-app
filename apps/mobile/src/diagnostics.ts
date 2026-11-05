import { NativeModules } from 'react-native';
import { diagnosticDetails } from '../../../packages/protocol/src/diagnostics';
export function logDiagnostic(
  event: string,
  details: Record<string, unknown> = {},
  level = 'INFO',
) {
  const safe = diagnosticDetails(details);
  NativeModules.Diagnostics?.append(event, JSON.stringify(safe), level);
}
export async function readDiagnostics(): Promise<string> {
  return NativeModules.Diagnostics?.read() ?? '日志模块不可用';
}
export async function exportDiagnostics() {
  await NativeModules.Diagnostics.exportLog();
}
