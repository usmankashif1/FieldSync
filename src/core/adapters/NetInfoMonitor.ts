import NetInfo from '@react-native-community/netinfo';
import type { NetworkMonitor } from '../queue/types';

let online = false;
let eventVersion = 0;
const listeners = new Set<(online: boolean) => void>();

const setOnline = (nextOnline: boolean): void => {
  if (online === nextOnline) {
    return;
  }
  
  online = nextOnline;
  listeners.forEach(listener => listener(nextOnline));
};


const unsubscribe = NetInfo.addEventListener(state => {
  eventVersion += 1;
  setOnline(state.isConnected === true);
});


export const netInfoMonitor = {
  isOnline: (): boolean => online,

  onChange: (listener: (online: boolean) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  initialize: async (): Promise<void> => {
    const versionBeforeFetch = eventVersion;
    const state = await NetInfo.fetch();
    if (versionBeforeFetch === eventVersion) {
      setOnline(state.isConnected === true);
    }
  },

  dispose: (): void => {
    unsubscribe();
    listeners.clear();
  },

  
} satisfies NetworkMonitor & {
  initialize(): Promise<void>;
  dispose(): void;
};
