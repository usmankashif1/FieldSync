export type PermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined';

export const isGranted = (state: PermissionState): boolean => state === 'granted';

// Add feature specific permission helpers here (camera, notifications, location...).
