import { Platform } from 'react-native';
import type { Permission, PermissionStatus } from 'react-native-permissions';

type PermissionModule = typeof import('react-native-permissions');

export type PermissionRequestResult = 'granted' | 'limited' | 'denied' | 'blocked' | 'unavailable';

let permissionModule: PermissionModule | undefined;

const getPermissionModule = (): PermissionModule => {
    // Load on demand so Jest can render screens without a linked native permissions module.
    permissionModule ??= require('react-native-permissions') as PermissionModule;
    return permissionModule;
};

const getCameraPermission = (): Permission => {
    const { PERMISSIONS } = getPermissionModule();
    return Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
};

const getGalleryPermission = (): Permission => {
    const { PERMISSIONS } = getPermissionModule();

    if (Platform.OS === 'ios') {
        return PERMISSIONS.IOS.PHOTO_LIBRARY;
    }

    return Number(Platform.Version) >= 33
        ? PERMISSIONS.ANDROID.READ_MEDIA_IMAGES
        : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
};

const mapPermissionStatus = (status: PermissionStatus): PermissionRequestResult => {
    const { RESULTS } = getPermissionModule();

    if (status === RESULTS.GRANTED) {
        return 'granted';
    }
    if (status === RESULTS.LIMITED) {
        return 'limited';
    }
    if (status === RESULTS.DENIED) {
        return 'denied';
    }
    if (status === RESULTS.BLOCKED) {
        return 'blocked';
    }

    return 'unavailable';
};

const requestPermission = async (permission: Permission): Promise<PermissionRequestResult> => {
    const permissions = getPermissionModule();
    const currentStatus = await permissions.check(permission);

    if (currentStatus !== permissions.RESULTS.DENIED) {
        return mapPermissionStatus(currentStatus);
    }

    // A denied permission can be requested again; the OS decides whether to show its prompt.
    return mapPermissionStatus(await permissions.request(permission));
};

/** Requests camera access when the user chooses a camera action. */
export const requestCameraPermission = (): Promise<PermissionRequestResult> =>
    requestPermission(getCameraPermission());

/** Requests photo-library access when the user chooses to upload an image. */
export const requestGalleryPermission = (): Promise<PermissionRequestResult> =>
    requestPermission(getGalleryPermission());

/** Opens app settings when the operating system will no longer show a permission prompt. */
export const openPermissionSettings = (): Promise<void> => getPermissionModule().openSettings();
