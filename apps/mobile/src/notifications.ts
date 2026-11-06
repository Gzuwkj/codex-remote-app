import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { client } from './client';
export type NotificationStatus = {
  enabled: boolean;
  permitted: boolean;
  connected: boolean;
  running: boolean;
  batteryExempt?: boolean;
  backgroundRestricted?: boolean;
  manufacturer?: string;
  lastReceivedAt?: number;
};
export const notificationStatus = (): Promise<NotificationStatus> =>
  NativeModules.TaskNotifications.status();
export async function enableNotifications(request = true) {
  if (request && Platform.OS === 'android' && Number(Platform.Version) >= 33)
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  const status = await notificationStatus();
  if (!status.permitted) throw Error('通知权限已关闭，请到系统通知设置中允许');
  if (!client.credentials) throw Error('请先连接并配对电脑');
  await NativeModules.TaskNotifications.configure(
    client.url,
    client.credentials.deviceId,
    client.credentials.token,
  );
  return notificationStatus();
}
export async function restoreNotifications() {
  const status = await notificationStatus();
  if (status.enabled && status.permitted && client.credentials)
    return enableNotifications(false);
  return status;
}
export async function disableNotifications() {
  await NativeModules.TaskNotifications.disable();
  return notificationStatus();
}
