import { NativeModules } from 'react-native';
import { client } from './client';
import { logDiagnostic } from './diagnostics';
export type PhoneAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  uri: string;
};
export async function pickAttachments(
  images: boolean,
): Promise<PhoneAttachment[]> {
  return NativeModules.PhoneAttachments.pick(images);
}
export async function uploadAttachments(
  files: PhoneAttachment[],
  progress: (id: string, percent: number) => void,
): Promise<string[]> {
  const result: string[] = [];
  for (const file of files) {
    logDiagnostic('attachment.upload-start', { id: file.id, bytes: file.size });
    let state = await client.rpc('attachment/begin', {
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      sha256: file.sha256,
    });
    while (state.next < file.size) {
      const chunk = await NativeModules.PhoneAttachments.chunk(
        file.id,
        state.next,
      );
      state = await client.rpc('attachment/chunk', {
        id: file.id,
        offset: state.next,
        base64: chunk.base64,
      });
      progress(file.id, Math.round((state.next / file.size) * 100));
    }
    await client.rpc('attachment/finish', { id: file.id });
    result.push(file.id);
    logDiagnostic('attachment.upload-completed', {
      id: file.id,
      bytes: file.size,
    });
  }
  return result;
}
